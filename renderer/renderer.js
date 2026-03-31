const form = document.getElementById("report-form");
const clientInput = document.getElementById("client");
const fromInput = document.getElementById("from");
const toInput = document.getElementById("to");
const topInput = document.getElementById("top");
const submitButton = document.getElementById("submit-button");
const statusElement = document.getElementById("status");
const errorElement = document.getElementById("error");
const resultsCaptionElement = document.getElementById("results-caption");
const reportSectionsElement = document.getElementById("report-sections");
const REPORT_ACCOUNTS = ["4092", "4091"];
const ACCOUNT_CURRENCY_BY_NO = {
  "4092": "ALL",
  "4091": "EUR",
};
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

function getAccountCurrencyCode(accountNo) {
  return ACCOUNT_CURRENCY_BY_NO[String(accountNo || "").trim()] || "";
}

function buildAmountLabel(label, currencyCode) {
  return currencyCode ? `${label} (${currencyCode})` : label;
}

function renderSummaryHtml(summary, currencyCode) {
  const items = [
    { label: "Matched rows", value: summary.totalCount ?? 0 },
    { label: "Displayed rows", value: summary.displayedCount ?? 0 },
    { label: buildAmountLabel("Total amount", currencyCode), value: formatAmount(summary.totalAmount) },
    { label: buildAmountLabel("Total with VAT", currencyCode), value: formatAmount(summary.totalAmountTimes1_2) },
  ];

  return items
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

function renderMatchedClientsHtml(report) {
  const clients = report.summary?.matchedClients || [];
  const text =
    clients.length > 0 ? escapeHtml(clients.join(", ")) : report.loaded ? "No matched client names." : "No data yet.";
  const stateClass = clients.length > 0 ? "" : "empty";

  return `
    <div class="matched-clients-block">
      <h3>Matched Clients</h3>
      <p class="matched-clients ${stateClass}">${text}</p>
    </div>
  `;
}

function renderRowsHtml(rows, loaded) {
  if (!rows || rows.length === 0) {
    const message = loaded ? "No rows matched the current request." : "Run a report to see rows here.";
    return `<tr><td colspan="9" class="empty-state">${message}</td></tr>`;
  }

  return rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.postingDate)}</td>
          <td>${escapeHtml(row.documentDate)}</td>
          <td>${escapeHtml(row.documentNo)}</td>
          <td>${escapeHtml(row.documentFiscalNo)}</td>
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

function buildResultsCaption({ clientSearch, from, to }) {
  const captionParts = ["Accounts 4092 (ALL) and 4091 (EUR)"];

  if (clientSearch) {
    captionParts.push(`Client search: ${clientSearch}`);
  }

  if (from || to) {
    captionParts.push(`Date range: ${from || "..."} to ${to || "..."}`);
  }

  return captionParts.join(" | ");
}

function buildSectionCaption(report) {
  const currencyCode = report.currencyCode || getAccountCurrencyCode(report.accountNo);
  const currencyText = currencyCode ? `Currency: ${currencyCode}. ` : "";

  if (!report.loaded) {
    return `${currencyText}Run a report to load this account.`;
  }

  if (report.summary.totalCount === report.summary.displayedCount) {
    return `${currencyText}Showing ${report.summary.displayedCount} row(s).`;
  }

  return `${currencyText}Showing ${report.summary.displayedCount} of ${report.summary.totalCount} row(s).`;
}

function renderReportSections(reports) {
  reportSectionsElement.innerHTML = reports
    .map((report) => {
      const currencyCode = report.currencyCode || getAccountCurrencyCode(report.accountNo);

      return `
        <section class="account-report">
          <div class="account-report-header">
            <div>
              <p class="account-eyebrow">G/L Account</p>
              <div class="account-title-row">
                <h3>${escapeHtml(report.accountNo)}</h3>
                ${currencyCode ? `<span class="currency-badge">${escapeHtml(currencyCode)}</span>` : ""}
              </div>
            </div>
            <p class="account-report-caption">${escapeHtml(buildSectionCaption(report))}</p>
          </div>

          <div class="summary-grid">${renderSummaryHtml(report.summary, currencyCode)}</div>
          ${renderMatchedClientsHtml(report)}

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Posting Date</th>
                  <th>Document Date</th>
                  <th>Document No</th>
                  <th>Document No. Fiscal</th>
                  <th>Document Type</th>
                  <th>G/L Description</th>
                  <th>Client Name</th>
                  <th>${escapeHtml(buildAmountLabel("Amount", currencyCode))}</th>
                  <th>${escapeHtml(buildAmountLabel("Amount with VAT", currencyCode))}</th>
                </tr>
              </thead>
              <tbody>
                ${renderRowsHtml(report.rows, report.loaded)}
              </tbody>
            </table>
          </div>
        </section>
      `;
    })
    .join("");
}

function buildEmptyReport(accountNo) {
  return {
    accountNo,
    currencyCode: getAccountCurrencyCode(accountNo),
    loaded: false,
    rows: [],
    summary: {
      totalCount: 0,
      displayedCount: 0,
      matchedClients: [],
      totalAmount: 0,
      totalAmountTimes1_2: 0,
    },
  };
}

function buildRequestPayload() {
  const topValue = topInput.value.trim();

  return {
    clientSearch: clientInput.value.trim(),
    from: fromInput.value,
    to: toInput.value,
    top: topValue ? Number(topValue) : null,
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");
  setStatus("Fetching data from Business Central for accounts 4092 and 4091...");
  submitButton.disabled = true;

  try {
    const requestPayload = buildRequestPayload();
    const responses = await Promise.all(
      REPORT_ACCOUNTS.map((accountNo) => window.ledgerApp.runReport({ ...requestPayload, accountNo }))
    );
    const failedResponse = responses.find((response) => !response.ok);

    if (failedResponse) {
      throw new Error(failedResponse.error || "Unknown error.");
    }

    const reports = responses.map((response) => ({
      ...response.report,
      loaded: true,
    }));
    const totalDisplayedRows = reports.reduce((sum, report) => sum + (report.summary.displayedCount || 0), 0);

    renderReportSections(reports);
    resultsCaptionElement.textContent = buildResultsCaption(requestPayload);
    setStatus(`Loaded ${totalDisplayedRows} row(s) across ${reports.length} account table(s).`);
  } catch (error) {
    renderReportSections(REPORT_ACCOUNTS.map(buildEmptyReport));
    resultsCaptionElement.textContent = "No report loaded.";
    setError(error.message);
    setStatus("Request failed.");
  } finally {
    submitButton.disabled = false;
  }
});

renderReportSections(REPORT_ACCOUNTS.map(buildEmptyReport));
