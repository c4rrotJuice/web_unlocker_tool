export const overlayCss = `
  :host {
    all: initial;
  }

  .writior-overlay-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483645;
    font-family: "Segoe UI", sans-serif;
  }

  .writior-pill {
    position: fixed;
    display: flex;
    gap: 6px;
    align-items: center;
    background: #0f172a;
    color: #f8fafc;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 999px;
    box-shadow: 0 16px 36px rgba(15, 23, 42, 0.28);
    padding: 6px;
    pointer-events: auto;
  }

  .writior-pill button {
    all: unset;
    cursor: pointer;
    padding: 7px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: inherit;
  }

  .writior-pill button:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .writior-note {
    position: fixed;
    width: min(360px, 88vw);
    background: #fff;
    color: #0f172a;
    border-radius: 16px;
    padding: 14px;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.24);
    border: 1px solid rgba(15, 23, 42, 0.12);
    pointer-events: auto;
  }

  .writior-note h2 {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 700;
  }

  .writior-note textarea,
  .writior-note input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid rgba(15, 23, 42, 0.16);
    border-radius: 10px;
    padding: 9px 10px;
    font: inherit;
    margin-bottom: 8px;
  }

  .writior-note textarea {
    min-height: 120px;
    resize: vertical;
  }

  .writior-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .writior-actions button {
    all: unset;
    cursor: pointer;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid rgba(15, 23, 42, 0.14);
    font-size: 12px;
    font-weight: 600;
  }

  .writior-actions .primary {
    background: #0f172a;
    color: #f8fafc;
  }
`;

