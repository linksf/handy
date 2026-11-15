import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { mediaData } from "../utils/captureMedia";
import Btn from "./ui/Btn";

export default function VoiceDraft({ apply, online }) {
  const [blob, setBlob] = useState(null);
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const recorder = useRef(null);
  const stream = useRef(null);
  const timer = useRef(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);
  const start = async () => {
    setError(""); setBusy(true);
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      const media = new MediaRecorder(input, mimeType ? { mimeType } : {});
      const chunks = [];
      recorder.current = media;
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      media.onstop = () => {
        clearTimeout(timer.current);
        input.getTracks().forEach(track => track.stop());
        if (mounted.current) {
          setRecording(false);
          setBlob(new Blob(chunks, { type: media.mimeType || chunks[0]?.type }));
        }
      };
      media.start(); setRecording(true);
      timer.current = setTimeout(() => { if (media.state === "recording") media.stop(); }, 60000);
    } catch { stream.current?.getTracks().forEach(track => track.stop()); setError("Microphone unavailable. Choose an audio file or type a note."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const transcribe = async sample => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await httpsCallable(functions, "draftAdminCapture")({
        kind: "voice", data: sample ? "fixture" : await mediaData(blob),
        mimeType: sample ? "audio/webm" : blob.type.split(";")[0],
      });
      setTranscript(response.data.transcript || "");
      setDraft(response.data.proposedNote || "");
      setNotice(response.data.review || "");
    } catch (err) { setError(err.message || "Voice draft unavailable."); }
    finally { setBusy(false); }
  };
  return <details>
    <summary>Voice to draft</summary>
    <p>Review the transcript and edit the note before adding it to the job capture.</p>
    <div className="admin-action-row">
      {recording ? <Btn onClick={() => recorder.current?.stop()}>Stop recording</Btn> :
        <Btn disabled={busy || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder} onClick={start}>Record voice note</Btn>}
      <Btn disabled={!blob || !online || busy || recording} onClick={() => transcribe(false)}>Draft from recording</Btn>
      {import.meta.env.HANDY_SYNTHETIC_PREVIEW && <Btn disabled={busy || !online} onClick={() => transcribe(true)}>Use sample dictation</Btn>}
    </div>
    <label className="intake-field">Audio file<input type="file" accept="audio/*" disabled={recording || busy} onChange={event => setBlob(event.target.files[0] || null)} /></label>
    {blob && <p role="status">Recording ready.</p>}
    {transcript && <p className="intake-message">Transcript · {transcript}</p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    <label className="intake-field" htmlFor="voice-proposal">Proposed voice note</label><textarea id="voice-proposal" value={draft} onChange={event => setDraft(event.target.value)} rows={3} />
    <Btn disabled={!draft.trim()} onClick={() => apply(draft.trim())}>Use draft in capture</Btn>
  </details>;
}
