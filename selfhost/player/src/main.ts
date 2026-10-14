// The player page. A join link is `<public origin>/#<table code>` (OnlineTable.link in the plugin).
// The socket to open is `/api/tables/<code>/socket` on this same origin; see selfhost/README.md.

function tableCodeFromLink(): string | null {
  const code = window.location.hash.slice(1);
  return code === '' ? null : code;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (app !== null) {
  const code = tableCodeFromLink();
  app.textContent = code === null ? 'No table code in this link.' : `Table ${code}`;
}
