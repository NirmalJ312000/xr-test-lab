// =============================================================================
//  XRTestProfiler.cs
//  Drop-in XR performance capture component for student VR/AR Unity projects.
//
//  WHAT IT DOES
//    - Records FPS, frame time (ms), 1% low FPS, dropped frames,
//      total/mono memory, draw calls, triangles, and battery/thermal where
//      available, during a timed test session.
//    - Writes a JSON report to the device's persistentDataPath at the end.
//    - That JSON is then loaded into the "XR Test Lab" web dashboard.
//
//  HOW TO USE (give these steps to your students, or do it yourself)
//    1. Create an empty GameObject in the first scene, name it "XRTestProfiler".
//    2. Add this script to it.
//    3. Fill in Project Name and Student Name in the Inspector.
//    4. Set Target FPS (72 or 90 for VR, 60 for mobile AR).
//    5. Press Play (or build & run). Profiling starts AUTOMATICALLY and is
//       finalized automatically when you press Stop / quit / the object is
//       destroyed. F1 / F2 remain available as a manual override where the
//       legacy Input Manager is enabled.
//    6. Grab the JSON file from the path logged to the console and load it
//       into the dashboard.
//
//  MIGRATING A SCENE THAT ALREADY HAS THIS COMPONENT
//    Automatic start is versioned via the hidden `_configVersion` field.
//    A component serialized before this version has _configVersion = 0 and is
//    upgraded to autoStartOnPlay = true on load (and in the Editor on
//    OnValidate — re-save the scene to persist it). After that upgrade your
//    own Inspector choice is respected and never forced again.
//
//  Works in the Editor and in builds. No external packages required.
//  Draw call / triangle stats use UnityStats in the Editor only; in builds
//  those fields are reported as -1 (use the Editor run for rendering stats).
// =============================================================================

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEngine;

#if UNITY_EDITOR
using UnityEditor;
#endif

public class XRTestProfiler : MonoBehaviour
{
    [Header("Project Identification")]
    public string projectName = "Untitled Project";
    public string studentName = "Unknown Student";
    public string studentId   = "";
    public string platform    = "VR"; // "VR" or "AR" - used as a label only

    [Header("Performance Targets")]
    [Tooltip("72 or 90 for VR headsets, 60 for mobile AR.")]
    public int targetFps = 72;

    [Header("Session Control")]
    [Tooltip("Profiling starts by itself when Play begins. Leave this on unless you want to drive sessions manually.")]
    public bool autoStartOnPlay = true;
    [Tooltip("If > 0 and autoStartOnPlay is on, the session stops automatically after this many seconds.")]
    public float autoStopAfterSeconds = 0f;
    public KeyCode startKey = KeyCode.F1;
    public KeyCode stopKey  = KeyCode.F2;

    [Header("Sampling")]
    [Tooltip("How often (seconds) to record a sample point for the time-series graph.")]
    public float sampleInterval = 0.5f;

    // ---- serialized config migration ----
    // Bumped whenever a default changes in a way that must also reach components
    // that were serialized under an older version. Unity keeps the value stored
    // in the scene/prefab, so changing a field initializer alone is NOT enough.
    private const int CurrentConfigVersion = 1;
    [SerializeField, HideInInspector] private int _configVersion = 0;

    // ---- runtime state ----
    private bool _running;
    private float _sessionStartTime;
    private float _lastSampleTime;
    private readonly List<float> _frameTimesMs = new List<float>();   // every frame
    private readonly List<Sample> _samples = new List<Sample>();      // downsampled series
    private int _droppedFrames;
    private float _targetFrameMs;
    private bool _skipWarmupFrame;      // discard the Play-Mode / scene-load hitch
#if ENABLE_LEGACY_INPUT_MANAGER
    private bool _hotkeysUnavailable;   // latched after the first input failure
#endif

    [Serializable]
    private struct Sample
    {
        public float t;        // seconds since session start
        public float fps;
        public float frameMs;
        public float memMB;
    }

    // Upgrades a component that was serialized before automatic start existed.
    // Runs once per component; afterwards the user's own choice is preserved.
    private void MigrateConfig()
    {
        if (_configVersion >= CurrentConfigVersion) return;

        // v0 -> v1: automatic start became the default.
        if (_configVersion < 1) autoStartOnPlay = true;

        _configVersion = CurrentConfigVersion;
    }

#if UNITY_EDITOR
    void OnValidate()
    {
        // Applies the upgrade in edit mode so the Inspector shows the real value.
        // Save the scene to persist it.
        MigrateConfig();
    }
#endif

    void Awake()
    {
        // Runtime safety net: guarantees the upgrade even if the scene was never
        // re-saved after OnValidate ran.
        MigrateConfig();
        RefreshFrameBudget();
    }

    void Start()
    {
        RefreshFrameBudget();
        if (autoStartOnPlay) StartSession();
    }

    void Update()
    {
        // Metric collection runs FIRST and is never gated behind input polling,
        // so a missing/disabled legacy Input Manager can't stop the recording.
        if (_running) RecordFrame();

        PollHotkeys();
    }

    // ---- session finalization -------------------------------------------------
    // StopSession() is the only writer of the report, so every way a session can
    // end has to funnel into it. OnApplicationQuit fires first on quit / Play
    // Mode exit; OnDisable covers component disable, object destruction and
    // scene unload. StopSession() clears _running before doing any work, so the
    // second callback is a no-op and the report is written exactly once.

    void OnApplicationQuit()
    {
        FinalizeIfRunning("application quit");
    }

    void OnDisable()
    {
        FinalizeIfRunning("profiler disabled or destroyed");
    }

    private void FinalizeIfRunning(string reason)
    {
        if (!_running) return;
        Debug.Log($"[XRTestProfiler] Finalizing active session ({reason}).");
        StopSession();
    }

    private void RefreshFrameBudget()
    {
        _targetFrameMs = 1000f / Mathf.Max(1, targetFps);
    }

    private void RecordFrame()
    {
        // The first frame after a session starts carries the Play-Mode / scene
        // load stall (often 100-500 ms). Counting it would wreck minFps, the 1%
        // low and the dropped-frame count, so it is discarded outright.
        if (_skipWarmupFrame)
        {
            _skipWarmupFrame = false;
            return;
        }

        float frameMs = Time.unscaledDeltaTime * 1000f;
        _frameTimesMs.Add(frameMs);

        // Never allow a zero budget - it would mark every frame as dropped.
        if (_targetFrameMs <= 0f) RefreshFrameBudget();

        // A "dropped" frame = took meaningfully longer than the target budget.
        if (frameMs > _targetFrameMs * 1.5f) _droppedFrames++;

        float now = Time.unscaledTime;
        if (now - _lastSampleTime >= sampleInterval)
        {
            _lastSampleTime = now;
            _samples.Add(new Sample
            {
                t       = now - _sessionStartTime,
                fps     = 1000f / Mathf.Max(0.0001f, frameMs),
                frameMs = frameMs,
                memMB   = CurrentMemoryMB()
            });
        }

        if (autoStartOnPlay && autoStopAfterSeconds > 0f &&
            now - _sessionStartTime >= autoStopAfterSeconds)
        {
            StopSession();
        }
    }

    // F1 / F2 are a manual override only. They are compiled out entirely when the
    // project runs on the new Input System alone (ENABLE_LEGACY_INPUT_MANAGER is
    // undefined), and any unexpected failure latches them off instead of throwing
    // every frame. No Input System package reference is introduced.
    private void PollHotkeys()
    {
#if ENABLE_LEGACY_INPUT_MANAGER
        if (_hotkeysUnavailable) return;
        try
        {
            if (Input.GetKeyDown(startKey) && !_running) StartSession();
            else if (Input.GetKeyDown(stopKey) && _running) StopSession();
        }
        catch (Exception e)
        {
            _hotkeysUnavailable = true;
            Debug.LogWarning($"[XRTestProfiler] Keyboard hotkeys unavailable ({e.GetType().Name}: {e.Message}). " +
                             "Profiling is unaffected - sessions start automatically and finalize on Stop.");
        }
#endif
    }

    public void StartSession()
    {
        // Recomputed here so a session started before Start() (or after targetFps
        // was changed at runtime) always has a valid frame budget.
        RefreshFrameBudget();

        _running = true;
        _sessionStartTime = Time.unscaledTime;
        _lastSampleTime = _sessionStartTime;
        _frameTimesMs.Clear();
        _samples.Clear();
        _droppedFrames = 0;
        _skipWarmupFrame = true;
        Debug.Log($"[XRTestProfiler] Session STARTED for '{projectName}' (target {targetFps} FPS).");
    }

    public void StopSession()
    {
        if (!_running) return;
        _running = false;   // cleared first: re-entrant / duplicate calls are no-ops
        float duration = Time.unscaledTime - _sessionStartTime;
        string json = BuildReportJson(duration);

        string safeName = Sanitize(projectName);
        string fileName = $"xrtest_{safeName}_{DateTime.Now:yyyyMMdd_HHmmss}.json";
        string fullPath = null;

        try
        {
            #if UNITY_EDITOR
            string folderPath = Path.Combine(Application.dataPath, "XRTestReports");
            if (!Directory.Exists(folderPath))
                Directory.CreateDirectory(folderPath);

            fullPath = Path.Combine(folderPath, fileName);
            #else
            fullPath = Path.Combine(Application.persistentDataPath, fileName);
            #endif

            File.WriteAllText(fullPath, json);
        }
        catch (Exception e)
        {
            // Never swallow the reason - the capture is otherwise lost silently.
            Debug.LogError($"[XRTestProfiler] FAILED to write report to '{fullPath ?? "(path not resolved)"}': " +
                           $"{e.GetType().Name}: {e.Message}");
            Debug.LogException(e, this);
            Debug.LogWarning("[XRTestProfiler] Report JSON follows so the capture is not lost:\n" + json);
            return;
        }

        Debug.Log($"[XRTestProfiler] Session STOPPED. Report saved to:\n{fullPath}");
        Debug.Log("[XRTestProfiler] Load this JSON into the XR Test Lab dashboard.");
    }

    // ---- metric helpers ----

    private float CurrentMemoryMB()
    {
        long bytes = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong();
        return bytes / (1024f * 1024f);
    }

    private void ComputeFpsStats(out float avgFps, out float minFps, out float onePercentLow)
    {
        if (_frameTimesMs.Count == 0) { avgFps = minFps = onePercentLow = 0f; return; }

        double sum = 0; float worstMs = 0;
        var sorted = new List<float>(_frameTimesMs);
        foreach (var ms in _frameTimesMs) { sum += ms; if (ms > worstMs) worstMs = ms; }
        float avgMs = (float)(sum / _frameTimesMs.Count);
        avgFps = 1000f / Mathf.Max(0.0001f, avgMs);
        minFps = 1000f / Mathf.Max(0.0001f, worstMs);

        // 1% low = average FPS of the worst 1% of frames (industry-standard comfort metric)
        sorted.Sort();
        int onePctCount = Mathf.Max(1, Mathf.RoundToInt(sorted.Count * 0.01f));
        double slowSum = 0;
        for (int i = sorted.Count - onePctCount; i < sorted.Count; i++) slowSum += sorted[i];
        float slowAvgMs = (float)(slowSum / onePctCount);
        onePercentLow = 1000f / Mathf.Max(0.0001f, slowAvgMs);
    }

    private string BuildReportJson(float duration)
    {
        ComputeFpsStats(out float avgFps, out float minFps, out float onePctLow);

        int drawCalls = -1, triangles = -1;
#if UNITY_EDITOR
        drawCalls = UnityEditor.UnityStats.drawCalls;
        triangles = UnityEditor.UnityStats.triangles;
#endif
        float batteryLevel = SystemInfo.batteryLevel;            // -1 if unknown
        string batteryStatus = SystemInfo.batteryStatus.ToString();

        var sb = new StringBuilder();
        var ci = CultureInfo.InvariantCulture;
        sb.Append("{");
        sb.AppendFormat(ci, "\"schema\":\"xr-test-profile-v1\",");
        sb.AppendFormat(ci, "\"projectName\":{0},", Q(projectName));
        sb.AppendFormat(ci, "\"studentName\":{0},", Q(studentName));
        sb.AppendFormat(ci, "\"studentId\":{0},", Q(studentId));
        sb.AppendFormat(ci, "\"platform\":{0},", Q(platform));
        sb.AppendFormat(ci, "\"capturedAt\":{0},", Q(DateTime.Now.ToString("o", ci)));
        sb.AppendFormat(ci, "\"durationSec\":{0:0.0},", duration);
        sb.AppendFormat(ci, "\"targetFps\":{0},", targetFps);
        sb.AppendFormat(ci, "\"avgFps\":{0:0.0},", avgFps);
        sb.AppendFormat(ci, "\"minFps\":{0:0.0},", minFps);
        sb.AppendFormat(ci, "\"onePercentLowFps\":{0:0.0},", onePctLow);
        sb.AppendFormat(ci, "\"avgFrameMs\":{0:0.00},", _frameTimesMs.Count > 0 ? 1000f / Mathf.Max(0.1f, avgFps) : 0f);
        sb.AppendFormat(ci, "\"droppedFrames\":{0},", _droppedFrames);
        sb.AppendFormat(ci, "\"totalFrames\":{0},", _frameTimesMs.Count);
        sb.AppendFormat(ci, "\"memoryMB\":{0:0.0},", CurrentMemoryMB());
        sb.AppendFormat(ci, "\"drawCalls\":{0},", drawCalls);
        sb.AppendFormat(ci, "\"triangles\":{0},", triangles);
        sb.AppendFormat(ci, "\"batteryLevel\":{0:0.00},", batteryLevel);
        sb.AppendFormat(ci, "\"batteryStatus\":{0},", Q(batteryStatus));
        sb.AppendFormat(ci, "\"device\":{0},", Q(SystemInfo.deviceModel));
        sb.AppendFormat(ci, "\"gpu\":{0},", Q(SystemInfo.graphicsDeviceName));
        sb.AppendFormat(ci, "\"os\":{0},", Q(SystemInfo.operatingSystem));

        // time series
        sb.Append("\"series\":[");
        for (int i = 0; i < _samples.Count; i++)
        {
            var s = _samples[i];
            if (i > 0) sb.Append(",");
            sb.AppendFormat(ci, "{{\"t\":{0:0.0},\"fps\":{1:0.0},\"frameMs\":{2:0.00},\"memMB\":{3:0.0}}}",
                            s.t, s.fps, s.frameMs, s.memMB);
        }
        sb.Append("]");
        sb.Append("}");
        return sb.ToString();
    }

    private static string Q(string s)
    {
        if (s == null) return "\"\"";
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            switch (c)
            {
                case '\"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n");  break;
                case '\r': sb.Append("\\r");  break;
                case '\t': sb.Append("\\t");  break;
                default:   sb.Append(c);      break;
            }
        }
        sb.Append("\"");
        return sb.ToString();
    }

    private static string Sanitize(string s)
    {
        foreach (char c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
        return s.Replace(' ', '_');
    }

    // Optional on-screen readout while testing in a headset
    [Header("On-Screen Overlay")]
    public bool showOverlay = true;
    void OnGUI()
    {
        if (!showOverlay) return;
        var style = new GUIStyle { fontSize = 22, normal = { textColor = Color.white } };
        float fps = _frameTimesMs.Count > 0 ? 1000f / Mathf.Max(0.1f, _frameTimesMs[_frameTimesMs.Count - 1]) : 0f;
        string state = _running ? $"REC  {fps:0} FPS  drops:{_droppedFrames}" : "idle (press Start)";
        GUI.Label(new Rect(20, 20, 600, 40), $"[XRTestProfiler] {state}", style);
    }
}
