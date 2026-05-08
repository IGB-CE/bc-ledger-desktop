const form = document.getElementById("report-form");
const clientInput = document.getElementById("client");
const fromInput = document.getElementById("from");
const toInput = document.getElementById("to");
const topInput = document.getElementById("top");
const submitButton = document.getElementById("submit-button");
const cancelButton = document.getElementById("cancel-button");
const statusElement = document.getElementById("status");
const errorElement = document.getElementById("error");
const resultsPanelElement = document.getElementById("results-panel");
const resultsCaptionElement = document.getElementById("results-caption");
const resultsDurationElement = document.getElementById("results-duration");
const resultsLoadingElement = document.getElementById("results-loading");
const resultsLoadingMessageElement = document.getElementById("results-loading-message");
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
let currentReports = REPORT_ACCOUNTS.map(buildEmptyReport);
const textEncoder = new TextEncoder();
let activeSearchRequestId = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function setStatus(message) {
  statusElement.textContent = message;
}

function setError(message) {
  const hasMessage = Boolean(message);
  errorElement.hidden = !hasMessage;
  errorElement.textContent = message || "";
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "";
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  const seconds = durationMs / 1000;

  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function setResultsDuration(durationMs) {
  const text = formatDuration(durationMs);
  resultsDurationElement.hidden = !text;
  resultsDurationElement.textContent = text ? `Search time: ${text}` : "";
}

function setResultsLoading(isLoading, message = "Fetching ledger rows...") {
  resultsPanelElement.setAttribute("aria-busy", isLoading ? "true" : "false");
  resultsPanelElement.classList.toggle("is-loading", isLoading);
  resultsLoadingElement.hidden = !isLoading;
  resultsLoadingMessageElement.textContent = message;
  cancelButton.hidden = !isLoading;
  cancelButton.disabled = !isLoading;
}

function createSearchRequestId() {
  return `search-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function getReportColumns(report) {
  const baseColumns = [
    { key: "postingDate", label: "Date", type: "String", align: "left" },
    { key: "documentDate", label: "Doc Date", type: "String", align: "left" },
    { key: "documentNo", label: "Doc No", type: "String", align: "left" },
    { key: "documentFiscalNo", label: "Fiscal", type: "String", align: "left" },
    { key: "documentType", label: "Type", type: "String", align: "left" },
    { key: "glDescription", label: "G/L Description", type: "String", align: "left" },
    { key: "clientName", label: "Client", type: "String", align: "left" },
  ];

  if (String(report?.accountNo || "") === "4091") {
    return [
      ...baseColumns,
      { key: "amount", label: "Lek", type: "Number", align: "right", currencyCode: "ALL" },
      { key: "additionalCurrencyAmount", label: "EUR", type: "Number", align: "right", currencyCode: "EUR" },
      { key: "amountTimes1_2", label: "Lek + VAT", type: "Number", align: "right", currencyCode: "ALL" },
      {
        key: "additionalCurrencyAmountTimes1_2",
        label: "EUR + VAT",
        type: "Number",
        align: "right",
        currencyCode: "EUR",
      },
    ];
  }

  const currencyCode = report?.currencyCode || getAccountCurrencyCode(report?.accountNo);
  return [
    ...baseColumns,
    { key: "amount", label: "Amount", type: "Number", align: "right", currencyCode },
    { key: "amountTimes1_2", label: "With VAT", type: "Number", align: "right", currencyCode },
  ];
}

function renderSummaryHtml(report) {
  const summary = report.summary || {};
  const currencyCode = report.currencyCode || getAccountCurrencyCode(report.accountNo);
  const items = [
    { label: "Matched rows", value: summary.totalCount ?? 0 },
    { label: "Displayed rows", value: summary.displayedCount ?? 0 },
  ];

  if (String(report.accountNo || "") === "4091") {
    items.push(
      { label: "Lek total (ALL)", value: formatAmount(summary.totalAmount) },
      { label: "EUR total", value: formatAmount(summary.totalAdditionalCurrencyAmount) },
      { label: "Lek + VAT (ALL)", value: formatAmount(summary.totalAmountTimes1_2) },
      { label: "EUR + VAT", value: formatAmount(summary.totalAdditionalCurrencyAmountTimes1_2) }
    );
  } else {
    items.push(
      { label: buildAmountLabel("Total amount", currencyCode), value: formatAmount(summary.totalAmount) },
      { label: buildAmountLabel("With VAT", currencyCode), value: formatAmount(summary.totalAmountTimes1_2) }
    );
  }

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

function renderRowsHtml(report) {
  const rows = report.rows || [];
  const columns = getReportColumns(report);

  if (!rows || rows.length === 0) {
    const message = report.loaded ? "No rows matched the current request." : "Run a report to see rows here.";
    return `<tr><td colspan="${columns.length}" class="empty-state">${message}</td></tr>`;
  }

  return rows
    .map(
      (row) => `
        <tr>
          ${columns
            .map((column) => {
              const value = column.type === "Number" ? formatAmount(row[column.key]) : escapeHtml(row[column.key]);
              const className = [column.align === "right" ? "numeric" : "", column.key === "glDescription" ? "detail-cell" : ""]
                .filter(Boolean)
                .join(" ");
              return `<td${className ? ` class="${className}"` : ""}>${value}</td>`;
            })
            .join("")}
        </tr>
      `
    )
    .join("");
}

function renderColumnGroupHtml(report) {
  const isEurAccount = String(report.accountNo || "") === "4091";
  const widths = isEurAccount
    ? ["5.5%", "6%", "6.5%", "5.5%", "4.5%", "24%", "8%", "8%", "8%", "12%", "12%"]
    : ["6%", "7%", "7%", "5.5%", "5%", "34%", "10.5%", "12.5%", "12.5%"];

  return `<colgroup>${widths.map((width) => `<col style="width: ${width}" />`).join("")}</colgroup>`;
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

function sanitizeFileSegment(value, fallback) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized || fallback;
}

function sanitizeWorksheetName(value) {
  const sanitized = String(value || "Report")
    .replace(/[:\\/?*\[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (sanitized || "Report").slice(0, 31);
}

function buildExportFileName(report) {
  const accountNo = sanitizeFileSegment(report.accountNo, "account");
  const from = sanitizeFileSegment(report.from, "from");
  const to = sanitizeFileSegment(report.to, "to");
  const client = sanitizeFileSegment(report.clientSearch, "all-clients");

  return `ledger-${accountNo}-${client}-${from}-to-${to}.xlsx`;
}

function buildWorksheetCell(reference, value, type = "String", styleIndex = 0) {
  if (type === "Number") {
    return `<c r="${reference}" s="${styleIndex}"><v>${Number(value || 0)}</v></c>`;
  }

  return `<c r="${reference}" t="inlineStr" s="${styleIndex}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function getExcelColumnName(columnNumber) {
  let result = "";
  let current = columnNumber;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
}

function buildWorksheetRow(rowNumber, values) {
  const cells = values.map((cell, index) => {
    const reference = `${getExcelColumnName(index + 1)}${rowNumber}`;

    return buildWorksheetCell(reference, cell.value, cell.type, cell.styleIndex);
  });

  return `<row r="${rowNumber}">${cells.join("")}</row>`;
}

function encodeUtf8(value) {
  return textEncoder.encode(value);
}

function createCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let current = index;

    for (let bit = 0; bit < 8; bit += 1) {
      current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    }

    table[index] = current >>> 0;
  }

  return table;
}

const crc32Table = createCrc32Table();

function computeCrc32(bytes) {
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc = crc32Table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createZipDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;

  return { dosTime, dosDate };
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function concatenateUint8Arrays(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });

  return result;
}

function createZipEntry(name, data, localHeaderOffset, dosDateTime) {
  const nameBytes = encodeUtf8(name);
  const crc32 = computeCrc32(data);
  const localHeader = new Uint8Array(30 + nameBytes.length);
  const localHeaderView = new DataView(localHeader.buffer);

  writeUint32(localHeaderView, 0, 0x04034b50);
  writeUint16(localHeaderView, 4, 20);
  writeUint16(localHeaderView, 6, 0);
  writeUint16(localHeaderView, 8, 0);
  writeUint16(localHeaderView, 10, dosDateTime.dosTime);
  writeUint16(localHeaderView, 12, dosDateTime.dosDate);
  writeUint32(localHeaderView, 14, crc32);
  writeUint32(localHeaderView, 18, data.length);
  writeUint32(localHeaderView, 22, data.length);
  writeUint16(localHeaderView, 26, nameBytes.length);
  writeUint16(localHeaderView, 28, 0);
  localHeader.set(nameBytes, 30);

  const centralHeader = new Uint8Array(46 + nameBytes.length);
  const centralHeaderView = new DataView(centralHeader.buffer);

  writeUint32(centralHeaderView, 0, 0x02014b50);
  writeUint16(centralHeaderView, 4, 20);
  writeUint16(centralHeaderView, 6, 20);
  writeUint16(centralHeaderView, 8, 0);
  writeUint16(centralHeaderView, 10, 0);
  writeUint16(centralHeaderView, 12, dosDateTime.dosTime);
  writeUint16(centralHeaderView, 14, dosDateTime.dosDate);
  writeUint32(centralHeaderView, 16, crc32);
  writeUint32(centralHeaderView, 20, data.length);
  writeUint32(centralHeaderView, 24, data.length);
  writeUint16(centralHeaderView, 28, nameBytes.length);
  writeUint16(centralHeaderView, 30, 0);
  writeUint16(centralHeaderView, 32, 0);
  writeUint16(centralHeaderView, 34, 0);
  writeUint16(centralHeaderView, 36, 0);
  writeUint32(centralHeaderView, 38, 0);
  writeUint32(centralHeaderView, 42, localHeaderOffset);
  centralHeader.set(nameBytes, 46);

  return {
    localPart: concatenateUint8Arrays([localHeader, data]),
    centralHeader,
  };
}

function createZipArchive(files) {
  const dosDateTime = createZipDosDateTime();
  const localParts = [];
  const centralHeaders = [];
  let offset = 0;

  files.forEach((file) => {
    const entry = createZipEntry(file.name, file.data, offset, dosDateTime);
    localParts.push(entry.localPart);
    centralHeaders.push(entry.centralHeader);
    offset += entry.localPart.length;
  });

  const centralDirectory = concatenateUint8Arrays(centralHeaders);
  const endOfCentralDirectory = new Uint8Array(22);
  const endView = new DataView(endOfCentralDirectory.buffer);

  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralDirectory.length);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return concatenateUint8Arrays([...localParts, centralDirectory, endOfCentralDirectory]);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function buildWorksheetXml(report) {
  const currencyCode = report.currencyCode || getAccountCurrencyCode(report.accountNo);
  const exportColumns = getReportColumns(report);
  const lastColumnName = getExcelColumnName(Math.max(1, exportColumns.length));
  let rowNumber = 1;
  const summaryRows = [
    ["Account", report.accountNo || ""],
    ["Currency", currencyCode || ""],
    ["Client Search", report.clientSearch || ""],
    ["From", report.from || ""],
    ["To", report.to || ""],
    ["Displayed Rows", report.summary?.displayedCount ?? 0],
    ["Matched Rows", report.summary?.totalCount ?? 0],
    ...(String(report.accountNo || "") === "4091"
      ? [
          ["Total Value in lek", report.summary?.totalAmount ?? 0],
          ["Total Value in euro", report.summary?.totalAdditionalCurrencyAmount ?? 0],
          ["Total Value with VAT in lek", report.summary?.totalAmountTimes1_2 ?? 0],
          ["Total Value with VAT in euro", report.summary?.totalAdditionalCurrencyAmountTimes1_2 ?? 0],
        ]
      : [
          ["Total Amount", report.summary?.totalAmount ?? 0],
          ["Total Amount with VAT", report.summary?.totalAmountTimes1_2 ?? 0],
        ]),
    ["Matched Clients", (report.summary?.matchedClients || []).join(", ")],
    ["Generated At", new Date().toISOString()],
  ];
  const rows = [];

  summaryRows.forEach(([label, value]) => {
    rows.push(
      buildWorksheetRow(rowNumber, [
        { value: label, type: "String", styleIndex: 3 },
        { value, type: typeof value === "number" ? "Number" : "String", styleIndex: typeof value === "number" ? 2 : 0 },
      ])
    );
    rowNumber += 1;
  });

  rowNumber += 1;
  rows.push(
    buildWorksheetRow(
      rowNumber,
      exportColumns.map((column) => ({
        value: column.type === "Number" && column.currencyCode ? buildAmountLabel(column.label, column.currencyCode) : column.label,
        type: "String",
        styleIndex: 1,
      }))
    )
  );
  rowNumber += 1;

  (report.rows || []).forEach((row) => {
    rows.push(
      buildWorksheetRow(
        rowNumber,
        exportColumns.map((column) => ({
          value: row[column.key],
          type: column.type,
          styleIndex: column.type === "Number" ? 2 : 0,
        }))
      )
    );
    rowNumber += 1;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumnName}${Math.max(1, rowNumber - 1)}"/>
  <sheetViews>
    <sheetView workbookViewId="0"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="14" customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="4" width="18" customWidth="1"/>
    <col min="5" max="5" width="16" customWidth="1"/>
    <col min="6" max="6" width="42" customWidth="1"/>
    <col min="7" max="7" width="28" customWidth="1"/>
    <col min="8" max="${exportColumns.length}" width="16" customWidth="1"/>
  </cols>
  <sheetData>
    ${rows.join("")}
  </sheetData>
</worksheet>`;
}

function buildWorkbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function buildWorkbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font>
      <sz val="11"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
    <font>
      <b/>
      <sz val="11"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="FFD9EFEA"/>
        <bgColor indexed="64"/>
      </patternFill>
    </fill>
  </fills>
  <borders count="1">
    <border>
      <left/>
      <right/>
      <top/>
      <bottom/>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;
}

function buildExcelWorkbookBase64(report) {
  const sheetName = sanitizeWorksheetName(`Account ${report.accountNo}`);
  const files = [
    { name: "[Content_Types].xml", data: encodeUtf8(buildContentTypesXml()) },
    { name: "_rels/.rels", data: encodeUtf8(buildRootRelsXml()) },
    { name: "xl/workbook.xml", data: encodeUtf8(buildWorkbookXml(sheetName)) },
    { name: "xl/_rels/workbook.xml.rels", data: encodeUtf8(buildWorkbookRelsXml()) },
    { name: "xl/styles.xml", data: encodeUtf8(buildStylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: encodeUtf8(buildWorksheetXml(report)) },
  ];

  return bytesToBase64(createZipArchive(files));
}

function renderReportSections(reports) {
  reportSectionsElement.innerHTML = reports
    .map((report) => {
      const currencyCode = report.currencyCode || getAccountCurrencyCode(report.accountNo);
      const columns = getReportColumns(report);

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
            <div class="account-report-actions">
              <p class="account-report-caption">${escapeHtml(buildSectionCaption(report))}</p>
              <button
                type="button"
                class="export-button"
                data-export-account="${escapeHtml(report.accountNo)}"
                ${report.loaded ? "" : "disabled"}>
                Download Excel
              </button>
            </div>
          </div>

          <div class="summary-grid">${renderSummaryHtml(report)}</div>
          ${renderMatchedClientsHtml(report)}

          <div class="table-wrap">
            <table class="${String(report.accountNo || "") === "4091" ? "wide-ledger-table" : "standard-ledger-table"}">
              ${renderColumnGroupHtml(report)}
              <thead>
                <tr>
                  ${columns
                    .map((column) => {
                      const label =
                        column.type === "Number" && column.currencyCode
                          ? buildAmountLabel(column.label, column.currencyCode)
                          : column.label;
                      return `<th${column.align === "right" ? ' class="numeric"' : ""}>${escapeHtml(label)}</th>`;
                    })
                    .join("")}
                </tr>
              </thead>
              <tbody>
                ${renderRowsHtml(report)}
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
      totalAdditionalCurrencyAmount: 0,
      totalAmountTimes1_2: 0,
      totalAdditionalCurrencyAmountTimes1_2: 0,
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
  setResultsLoading(true, "Searching Business Central and building both account tables...");
  submitButton.disabled = true;
  setResultsDuration(null);
  const requestId = createSearchRequestId();
  activeSearchRequestId = requestId;
  const startedAt = performance.now();

  try {
    const requestPayload = buildRequestPayload();
    const response = await window.ledgerApp.runReports({
      ...requestPayload,
      accountNos: REPORT_ACCOUNTS,
      requestId,
    });

    if (activeSearchRequestId !== requestId) {
      return;
    }

    if (!response.ok) {
      if (response.canceled) {
        setStatus("Search canceled.");
        return;
      }

      throw new Error(response.error || "Unknown error.");
    }

    const reports = (response.reports || []).map((report) => ({
      ...report,
      loaded: true,
    }));
    const totalDisplayedRows = reports.reduce((sum, report) => sum + (report.summary.displayedCount || 0), 0);
    const elapsedMs = performance.now() - startedAt;

    currentReports = reports;
    renderReportSections(reports);
    resultsCaptionElement.textContent = buildResultsCaption(requestPayload);
    setResultsDuration(elapsedMs);
    setStatus(`Loaded ${totalDisplayedRows} row(s) across ${reports.length} account table(s) in ${formatDuration(elapsedMs)}.`);
  } catch (error) {
    if (activeSearchRequestId !== requestId) {
      return;
    }

    const elapsedMs = performance.now() - startedAt;

    currentReports = REPORT_ACCOUNTS.map(buildEmptyReport);
    renderReportSections(currentReports);
    resultsCaptionElement.textContent = "No report loaded.";
    setResultsDuration(elapsedMs);
    setError(error.message);
    setStatus(`Request failed after ${formatDuration(elapsedMs)}.`);
  } finally {
    if (activeSearchRequestId === requestId) {
      activeSearchRequestId = "";
      setResultsLoading(false);
      submitButton.disabled = false;
    }
  }
});

cancelButton.addEventListener("click", async () => {
  const requestId = activeSearchRequestId;

  if (!requestId) {
    return;
  }

  cancelButton.disabled = true;
  setStatus("Canceling search...");

  try {
    await window.ledgerApp.cancelSearch({ requestId });
  } catch (error) {
    setError(error.message);
    setStatus("Cancel failed.");
    cancelButton.disabled = false;
  }
});

reportSectionsElement.addEventListener("click", async (event) => {
  const exportButton = event.target.closest("[data-export-account]");

  if (!exportButton) {
    return;
  }

  const accountNo = exportButton.dataset.exportAccount;
  const report = currentReports.find((item) => String(item.accountNo) === String(accountNo));

  if (!report) {
    setError(`Could not find loaded data for account ${accountNo}.`);
    setStatus("Export failed.");
    return;
  }

  exportButton.disabled = true;
  setError("");
  setStatus(`Preparing Excel export for account ${accountNo}...`);

  try {
    const response = await window.ledgerApp.saveExport({
      suggestedName: buildExportFileName(report),
      contentBase64: buildExcelWorkbookBase64(report),
    });

    if (!response.ok) {
      if (response.canceled) {
        setStatus(`Export canceled for account ${accountNo}.`);
        return;
      }

      throw new Error(response.error || "Could not save export.");
    }

    setStatus(`Saved Excel export for account ${accountNo} to ${response.filePath}.`);
  } catch (error) {
    setError(error.message);
    setStatus("Export failed.");
  } finally {
    exportButton.disabled = false;
  }
});

renderReportSections(currentReports);
