import { useEffect, useState } from "react";
import { MAIN_HELP, MAIN_TUTORIAL } from "./helpContent";

const DONE_KEY = "auralith.tutorial.done";

export function tutorialDone() {
  try { return localStorage.getItem(DONE_KEY) === "1"; } catch { return true; }
}
export function setTutorialDone(v: boolean) {
  try { localStorage.setItem(DONE_KEY, v ? "1" : "0"); } catch { /* */ }
}

export function HelpOverlay(props: {
  version: string;
  mode: "tour" | "help" | "welcome";
  onClose: () => void;
  onOpenHelp: () => void;
}) {
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState(MAIN_HELP[0].id);
  const cur = MAIN_TUTORIAL[step];
  const help = MAIN_HELP.find((t) => t.id === topic) || MAIN_HELP[0];

  useEffect(() => { setStep(0); }, [props.mode]);

  if (props.mode === "welcome") {
    return (
      <div className="help-scrim" role="dialog" aria-label="Welcome to Auralith Reborn">
        <div className="help-card">
          <p className="help-kicker">Auralith Reborn {props.version}</p>
          <h2>WELCOME TO AURALITH REBORN</h2>
          <p>A short tour covers the workspace, Public Server, polls, Viewer QR vs Host QR, reactions, and updates.</p>
          <div className="row">
            <button onClick={props.onOpenHelp}>Start Tutorial</button>
            <button onClick={() => { setTutorialDone(true); props.onClose(); }}>Skip For Now</button>
          </div>
        </div>
      </div>
    );
  }

  if (props.mode === "tour") {
    return (
      <div className="help-scrim" role="dialog" aria-label="Auralith tutorial">
        <div className="help-card">
          <p className="help-kicker">Tutorial {step + 1} / {MAIN_TUTORIAL.length}</p>
          <h2>{cur.title}</h2>
          <p>{cur.body}</p>
          <div className="row">
            <button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</button>
            {step < MAIN_TUTORIAL.length - 1 ? (
              <button onClick={() => setStep((s) => s + 1)}>Next</button>
            ) : (
              <>
                <button onClick={() => { setTutorialDone(true); props.onClose(); }}>Open Auralith</button>
                <button onClick={() => { setTutorialDone(true); props.onOpenHelp(); }}>Open Help Center</button>
              </>
            )}
            <button onClick={() => { setTutorialDone(true); props.onClose(); }}>Skip</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="help-scrim" role="dialog" aria-label="Help Center">
      <div className="help-card help-wide">
        <p className="help-kicker">Help & Tutorials · Auralith Reborn {props.version}</p>
        <h2>HELP CENTER</h2>
        <div className="help-split">
          <nav aria-label="Help topics">
            {MAIN_HELP.map((t) => (
              <button key={t.id} className={topic === t.id ? "on" : ""} onClick={() => setTopic(t.id)}>{t.title}</button>
            ))}
          </nav>
          <article>
            <h3>{help.title}</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{help.body}</p>
          </article>
        </div>
        <div className="row">
          <button onClick={props.onOpenHelp}>Replay Tutorial</button>
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <button className="hint" type="button" title={text} aria-label={text}>?</button>
  );
}
