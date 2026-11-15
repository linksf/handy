import {useEffect, useRef, useState} from "react";
import {httpsCallable} from "firebase/functions";
import {functions} from "../firebase";
import Btn from "./ui/Btn";

export default function ThumbtackConnection() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const handled = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (!params.has("thumbtack") || handled.current) return;
    handled.current = true;
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    if (params.has("error")) {
      setError("Thumbtack did not grant access. You can try connecting again.");
      return;
    }
    setBusy(true);
    httpsCallable(functions, "connectThumbtack")({
      action: "finish",
      code: params.get("code"),
      state: params.get("state"),
    }).then(({data}) => {
      setStatus(`Thumbtack connected (${data.environment}).`);
    }).catch((err) => {
      setError(err.message);
    }).finally(() => setBusy(false));
  }, []);

  async function start() {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const {data} = await httpsCallable(functions, "connectThumbtack")({action: "start"});
      window.location.assign(data.url);
    } catch (err) {
      setError(err.code === "functions/not-found" ?
        "Thumbtack OAuth is awaiting client setup." : err.message);
      setBusy(false);
    }
  }

  return (
    <div>
      <Btn disabled={busy} onClick={start}>Connect Thumbtack</Btn>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
