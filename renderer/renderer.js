const form = document.getElementById("report-form");
const clientInput = document.getElementById("client");
const fromInput = document.getElementById("from");
const toInput = document.getElementById("to");
const accountInput = document.getElementById("account");
const topInput = document.getElementById("top");
const submitButton = document.getElementById("submit-button");
const statusElement = document.getElementById("status");
const errorElement = document.getElementById("error");
const resultsCaptionElement = document.getElementById("results-caption");
const summaryElement = document.getElementById("summary");
const matchedClientsElement = document.getElementById("matched-clients");
const resultsBodyElement = document.getElementById("results-body");
const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(message) {
  statusElement.textContent = message;
}

function setError(message) {
  const hasMessage = Boolean(message);
  errorElement.hidden = !hasMessage;
  errorElement.textContent = message || "";
}

function formatAmount(value) {
  return currencyFormatter.format(Number(value || 0));
}

function renderSummary(summary) {
  const items = [
    { label: "Matched rows", value: summary.totalCount ?? 0 },
    { label: "Displayed rows", value: summary.displayedCount ?? 0 },
    { label: "Total amount", value: formatAmount(summary.totalAmount) },
    { label: "Total x 1.2", value: formatAmount(summary.totalAmountTimes1_2) },
  ];

  summaryElement.innerHTML = items
    .map(
      (item) => `
        <article class="summary-card">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
        </article>
      `
    )
    .join("");
}

function renderMatchedClients(clients) {
  if (!clients || clients.length === 0) {
    matchedClientsElement.textContent = "No matched client names.";
    matchedClientsElement.classList.add("empty");
    return;
  }

  matchedClientsElement.textContent = clients.join(", ");
  matchedClientsElement.classList.remove("empty");
}

function renderRows(rows) {
  if (!rows || rows.length === 0) {
    resultsBodyElement.innerHTML = '<tr><td colspan="8" class="empty-state">No rows matched the current request.</td></tr>';
    return;
  }

  resultsBodyElement.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.postingDate)}</td>
          <td>${escapeHtml(row.documentDate)}</td>
          <td>${escapeHtml(row.documentNo)}</td>
          <td>${escapeHtml(row.documentType)}</td>
          <td class="detail-cell">${escapeHtml(row.glDescription)}</td>
          <td>${escapeHtml(row.clientName)}</td>
          <td class="numeric">${formatAmount(row.amount)}</td>
          <td class="numeric">${formatAmount(row.amountTimes1_2)}</td>
        </tr>
      `
    )
    .join("");
}

function buildRequestPayload() {
  const topValue = topInput.value.trim();

  return {
    clientSearch: clientInput.value.trim(),
    from: fromInput.value,
    to: toInput.value,
    accountNo: accountInput.value.trim(),
    top: topValue ? Number(topValue) : null,
  };
}

async function loadDefaults() {
  const defaults = await window.ledgerApp.getDefaults();
  accountInput.value = defaults.accountNo || "4092";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");
  setStatus("Fetching data from Business Central...");
  submitButton.disabled = true;

  try {
    const response = await window.ledgerApp.runReport(buildRequestPayload());

    if (!response.ok) {
      throw new Error(response.error || "Unknown error.");
    }

    const { report } = response;
    renderSummary(report.summary);
    renderMatchedClients(report.summary.matchedClients);
    renderRows(report.rows);

    const captionParts = [];

    if (report.clientSearch) {
      captionParts.push(`Client search: ${report.clientSearch}`);
    }

    if (report.from || report.to) {
      captionParts.push(`Date range: ${report.from || "..."} to ${report.to || "..."}`);
    }

    resultsCaptionElement.textContent =
      captionParts.length > 0 ? captionParts.join(" | ") : `Account ${report.accountNo}`;
    setStatus(`Loaded ${report.summary.displayedCount} row(s).`);
  } catch (error) {
    renderSummary({
      totalCount: 0,
      displayedCount: 0,
      totalAmount: 0,
      totalAmountTimes1_2: 0,
    });
    renderMatchedClients([]);
    renderRows([]);
    resultsCaptionElement.textContent = "No report loaded.";
    setError(error.message);
    setStatus("Request failed.");
  } finally {
    submitButton.disabled = false;
  }
});

loadDefaults()
  .then(() => {
    renderSummary({
      totalCount: 0,
      displayedCount: 0,
      totalAmount: 0,
      totalAmountTimes1_2: 0,
    });
  })
  .catch((error) => {
    setError(error.message);
    setStatus("Failed to load defaults.");
  });
