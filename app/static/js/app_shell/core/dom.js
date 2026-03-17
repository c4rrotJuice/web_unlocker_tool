export function renderLoading(target, message = "Loading…") {
  target.innerHTML = `<div class="loading-state"><p>${message}</p></div>`;
}

export function renderError(target, message = "Something went wrong.", retryLabel = "Retry") {
  target.innerHTML = `
    <div class="error-state">
      <p>${message}</p>
      <button type="button" class="app-button-secondary" data-retry-button>${retryLabel}</button>
    </div>
  `;
}

export function renderEmpty(target, title, copy) {
  target.innerHTML = `
    <div class="empty-state">
      <strong>${title}</strong>
      <p>${copy}</p>
    </div>
  `;
}

export function bindRetry(target, callback) {
  const button = target.querySelector("[data-retry-button]");
  if (button) {
    button.addEventListener("click", callback);
  }
}
