import {
  renderCitationCard,
  renderDocumentCard,
  renderNoteCard,
  renderQuoteCard,
  renderSourceCard,
} from "../../app_shell/renderers/cards.js";

export function renderEntityCard(type, entity, options = {}) {
  if (type === "source") return renderSourceCard(entity, options);
  if (type === "citation") return renderCitationCard(entity, options);
  if (type === "quote") return renderQuoteCard(entity, options);
  if (type === "note") return renderNoteCard(entity, options);
  return renderDocumentCard(entity, options);
}
