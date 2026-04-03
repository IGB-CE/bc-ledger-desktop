const { buildOrFilter, chunkArray, escapeODataString, fetchAllEntity, fetchEntity } = require("./bc-client");
const { config } = require("./config");

const GL_DESCRIPTION_ACCOUNT_NUMBERS = ["4091", "4092"];
const ACCOUNT_REPORT_CONFIG = {
  "4092": {
    currencyCode: "ALL",
    amountField: "Amount",
  },
  "4091": {
    currencyCode: "EUR",
    amountField: "Additional_Currency_Amount",
  },
};
const DEFAULT_REPORT_ACCOUNTS = ["4092", "4091"];

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeClientName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function stripTrailingClientQualifiers(value) {
  let normalized = normalizeClientName(value);

  while (/\s*\([^)]*\)$/.test(normalized)) {
    normalized = normalized.replace(/\s*\([^)]*\)$/, "").trim();
  }

  return normalized;
}

function buildComparableClientTokenKey(value) {
  return stripTrailingClientQualifiers(value)
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function buildComparableClientTokens(value) {
  return [...new Set(stripTrailingClientQualifiers(value).split(" ").filter(Boolean))];
}

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildSearchVariants(value) {
  const normalized = normalizeString(value);

  return [...new Set([normalized, normalized.toLowerCase(), normalized.toUpperCase(), toTitleCase(normalized)].filter(Boolean))];
}

function getClientSearchTokens(searchTerm) {
  return normalizeClientName(searchTerm).split(" ").filter(Boolean);
}

function matchesNormalizedClientName(bcName, input) {
  const normalizedBcName = normalizeClientName(bcName);
  const normalizedInput = normalizeClientName(input);

  if (!normalizedBcName || !normalizedInput) {
    return false;
  }

  if (normalizedBcName === normalizedInput) {
    return true;
  }

  const strippedBcName = stripTrailingClientQualifiers(normalizedBcName);
  const strippedInput = stripTrailingClientQualifiers(normalizedInput);

  if (strippedBcName === strippedInput) {
    return true;
  }

  if (buildComparableClientTokenKey(strippedBcName) === buildComparableClientTokenKey(strippedInput)) {
    return true;
  }

  const bcTokens = buildComparableClientTokens(strippedBcName);
  const inputTokens = buildComparableClientTokens(strippedInput);

  return inputTokens.length > 0 && inputTokens.every((token) => bcTokens.includes(token));
}

function getAccountReportConfig(accountNo) {
  return (
    ACCOUNT_REPORT_CONFIG[normalizeString(accountNo)] || {
      currencyCode: "",
      amountField: "Amount",
    }
  );
}

function normalizeTop(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("`top` must be a positive integer.");
  }

  return parsed;
}

function normalizeAccountNumbers(accountNos) {
  const values = Array.isArray(accountNos) ? accountNos : [accountNos];
  const normalized = [...new Set(values.map((value) => normalizeString(value)).filter(Boolean))];

  return normalized.length > 0 ? normalized : [config.accountNo];
}

function buildDateClauses(fieldName, from, to) {
  const clauses = [];

  if (from) {
    clauses.push(`${fieldName} ge ${from}`);
  }

  if (to) {
    clauses.push(`${fieldName} le ${to}`);
  }

  return clauses;
}

function buildLedgerFilter({ accountNo, from, to, documentNumbers = [] }) {
  const clauses = [`G_L_Account_No eq '${accountNo}'`, ...buildDateClauses("Posting_Date", from, to)];
  const documentFilter = buildOrFilter("Document_No", documentNumbers);

  if (documentFilter) {
    clauses.push(`(${documentFilter})`);
  }

  return clauses.join(" and ");
}

async function fetchLedgerRows({ accountNo, from, to, documentNumbers = [], signal }) {
  return fetchAllEntity("G_LEntries", {
    filter: buildLedgerFilter({ accountNo, from, to, documentNumbers }),
    select: ["Entry_No", "Posting_Date", "Document_Date", "Document_No", "Document_Type", "Amount", "Additional_Currency_Amount"],
    signal,
  });
}

async function fetchLedgerRowsForDocumentNumbers({ accountNo, from, to, documentNumbers, signal }) {
  if (!documentNumbers || documentNumbers.length === 0) {
    return [];
  }

  const documentChunks = chunkArray(documentNumbers, 20);
  const ledgerRows = [];

  for (const chunk of documentChunks) {
    const chunkRows = await fetchLedgerRows({
      accountNo,
      from,
      to,
      documentNumbers: chunk,
      signal,
    });

    ledgerRows.push(...chunkRows);
  }

  return ledgerRows;
}

async function fetchFallbackCustomerMap(documentNumbers, signal) {
  const result = new Map();
  const chunks = chunkArray(documentNumbers, 20);

  for (const chunk of chunks) {
    const rows = await fetchEntity("Cust_LedgerEntries", {
      filter: buildOrFilter("Document_No", chunk),
      select: ["Document_No", "Customer_Name"],
      signal,
      top: chunk.length,
    });

    for (const row of rows) {
      if (row.Document_No && row.Customer_Name && !result.has(row.Document_No)) {
        result.set(row.Document_No, row.Customer_Name);
      }
    }
  }

  return result;
}

function buildContainsFilter(fieldName, searchTerm) {
  const tokens = getClientSearchTokens(searchTerm);

  if (tokens.length === 0) {
    return "";
  }

  return tokens
    .map((token) => {
      const variants = buildSearchVariants(token);

      return `(${variants.map((variant) => `contains(${fieldName},'${escapeODataString(variant)}')`).join(" or ")})`;
    })
    .join(" and ");
}

function buildHeaderSearchFilter({ fieldName, clientSearch, from, to }) {
  const clauses = [];
  const containsFilter = buildContainsFilter(fieldName, clientSearch);

  if (containsFilter) {
    clauses.push(`(${containsFilter})`);
  }

  clauses.push(...buildDateClauses("Posting_Date", from, to));

  return clauses.join(" and ");
}

async function fetchMatchingHeaderRows(entity, nameField, { clientSearch, from, to, signal }) {
  const filter = buildHeaderSearchFilter({ fieldName: nameField, clientSearch, from, to });
  const rows = await fetchAllEntity(entity, {
    filter,
    select: ["No", nameField, "Posting_Date", "Document_Date"],
    signal,
  });

  return rows.filter((row) => matchesNormalizedClientName(row[nameField], clientSearch));
}

async function fetchMatchingDocumentNameMap({ clientSearch, from, to, signal }) {
  const result = new Map();
  const invoices = await fetchMatchingHeaderRows("PostedSalesInvoice", "Sell_to_Customer_Name", {
    clientSearch,
    from,
    to,
    signal,
  });
  const creditMemos = await fetchMatchingHeaderRows("PSCM", "Sell_to_Customer_Name", {
    clientSearch,
    from,
    to,
    signal,
  });

  for (const row of [...invoices, ...creditMemos]) {
    if (row.No && row.Sell_to_Customer_Name && !result.has(row.No)) {
      result.set(row.No, row.Sell_to_Customer_Name.trim());
    }
  }

  return result;
}

async function fetchHeaderFieldMapForEntity(entity, documentNumbers, fieldName, signal) {
  const result = new Map();
  const uniqueDocumentNumbers = [...new Set(documentNumbers)];
  const chunks = chunkArray(uniqueDocumentNumbers, 20);

  for (const chunk of chunks) {
    const rows = await fetchEntity(entity, {
      filter: buildOrFilter("No", chunk),
      select: ["No", fieldName],
      signal,
      top: chunk.length,
    });

    for (const row of rows) {
      const fieldValue = normalizeString(row[fieldName]);

      if (row.No && fieldValue && !result.has(row.No)) {
        result.set(row.No, fieldValue);
      }
    }
  }

  return result;
}

async function fetchHeaderNameMapForEntity(entity, documentNumbers, signal) {
  return fetchHeaderFieldMapForEntity(entity, documentNumbers, "Sell_to_Customer_Name", signal);
}

async function fetchDocumentNameMap(documentNumbers, signal) {
  const invoiceMap = await fetchHeaderNameMapForEntity("PostedSalesInvoice", documentNumbers, signal);
  const creditMemoMap = await fetchHeaderNameMapForEntity("PSCM", documentNumbers, signal);

  return new Map([...invoiceMap, ...creditMemoMap]);
}

async function fetchDocumentFiscalNoMap(documentNumbers, signal) {
  const invoiceMap = await fetchHeaderFieldMapForEntity("PSI_Header", documentNumbers, "Document_No_Fiscal", signal);
  const creditMemoMap = await fetchHeaderFieldMapForEntity("PSCM", documentNumbers, "Document_No_Fiscal", signal);

  return new Map([...invoiceMap, ...creditMemoMap]);
}

function buildDocumentLineFilter(documentNumbers) {
  const documentFilter = buildOrFilter("Document_No", documentNumbers);
  const accountFilter = buildOrFilter("No", GL_DESCRIPTION_ACCOUNT_NUMBERS);

  if (!documentFilter || !accountFilter) {
    return "";
  }

  return `(${documentFilter}) and Type eq 'G/L Account' and (${accountFilter})`;
}

function extractDocumentLineDescription(row) {
  return normalizeString(row.Long_Description) || normalizeString(row.Description_2) || normalizeString(row.Description);
}

async function fetchDocumentLineDescriptionMapForEntity(entity, documentNumbers, select, signal) {
  const result = new Map();
  const uniqueDocumentNumbers = [...new Set(documentNumbers)];
  const chunks = chunkArray(uniqueDocumentNumbers, 20);

  for (const chunk of chunks) {
    const filter = buildDocumentLineFilter(chunk);

    if (!filter) {
      continue;
    }

    const rows = await fetchAllEntity(entity, {
      filter,
      select,
      signal,
    });

    rows
      .filter((row) => row.Document_No)
      .sort((left, right) => Number(left.Line_No || 0) - Number(right.Line_No || 0))
      .forEach((row) => {
        const description = extractDocumentLineDescription(row);

        if (description && !result.has(row.Document_No)) {
          result.set(row.Document_No, description);
        }
      });
  }

  return result;
}

async function fetchDocumentLineDescriptionMap(documentNumbers, signal) {
  const invoiceMap = await fetchDocumentLineDescriptionMapForEntity("PostedSalesInvoiceSalesInvLines", documentNumbers, [
    "Document_No",
    "Line_No",
    "Type",
    "No",
    "Long_Description",
    "Description_2",
    "Description",
  ], signal);
  const creditMemoMap = await fetchDocumentLineDescriptionMapForEntity("PSCM_Lines", documentNumbers, [
    "Document_No",
    "Line_No",
    "Type",
    "No",
    "Description_2",
    "Description",
  ], signal);

  return new Map([...invoiceMap, ...creditMemoMap]);
}

function mergeMaps(primaryMap, fallbackMap) {
  const merged = new Map(primaryMap);

  for (const [key, value] of fallbackMap.entries()) {
    if (!merged.has(key)) {
      merged.set(key, value);
    }
  }

  return merged;
}

function roundToTwo(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeDocumentType(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return "";
  }

  const compact = normalized.replace(/[_\s]+/g, " ").trim().toLowerCase();

  if (compact === "invoice") {
    return "Invoice";
  }

  if (compact === "credit memo") {
    return "Credit Memo";
  }

  return compact.replace(/\b\w/g, (character) => character.toUpperCase());
}

async function fetchLedgerRowsForClient({ accountNo, clientSearch, from, to, signal }) {
  const documentNameMap = await fetchMatchingDocumentNameMap({ clientSearch, from, to, signal });
  const documentNumbers = [...documentNameMap.keys()];

  if (documentNumbers.length === 0) {
    return {
      nameMap: documentNameMap,
      rows: [],
    };
  }

  const ledgerRows = await fetchLedgerRowsForDocumentNumbers({
    accountNo,
    from,
    to,
    documentNumbers,
    signal,
  });

  return {
    nameMap: documentNameMap,
    rows: ledgerRows,
  };
}

function sortLedgerRows(rows) {
  return [...rows].sort((left, right) => {
    const postingDateCompare = String(right.Posting_Date || "").localeCompare(String(left.Posting_Date || ""));

    if (postingDateCompare !== 0) {
      return postingDateCompare;
    }

    return String(right.Entry_No || "").localeCompare(String(left.Entry_No || ""));
  });
}

function buildReportRows(rows, nameMap, documentLineDescriptionMap, documentFiscalNoMap, accountReportConfig) {
  return rows.map((row) => {
    const amount = Number(row[accountReportConfig.amountField] ?? row.Amount ?? 0);

    return {
      postingDate: row.Posting_Date || "",
      documentDate: row.Document_Date || "",
      documentNo: row.Document_No || "",
      documentFiscalNo: documentFiscalNoMap.get(row.Document_No) || "",
      documentType: normalizeDocumentType(row.Document_Type),
      glDescription: documentLineDescriptionMap.get(row.Document_No) || "",
      clientName: nameMap.get(row.Document_No) || "",
      amount,
      amountTimes1_2: roundToTwo(amount * 1.2),
    };
  });
}

function buildSummary(allReportRows, displayedRows) {
  const totalAmount = roundToTwo(allReportRows.reduce((sum, row) => sum + row.amount, 0));
  const totalAmountTimes1_2 = roundToTwo(allReportRows.reduce((sum, row) => sum + row.amountTimes1_2, 0));
  const clientNames = [...new Set(allReportRows.map((row) => row.clientName).filter(Boolean))].sort();

  return {
    totalCount: allReportRows.length,
    displayedCount: displayedRows.length,
    matchedClients: clientNames,
    totalAmount,
    totalAmountTimes1_2,
  };
}

async function buildLedgerReportFromRows({ accountNo, clientSearch, from, to, top, ledgerRows, nameMap, signal }) {
  const accountReportConfig = getAccountReportConfig(accountNo);
  const sortedRows = sortLedgerRows(ledgerRows);
  const documentNumbers = sortedRows.map((row) => row.Document_No);
  const documentLineDescriptionMap = await fetchDocumentLineDescriptionMap(documentNumbers, signal);
  const documentFiscalNoMap = await fetchDocumentFiscalNoMap(documentNumbers, signal);
  const allReportRows = buildReportRows(
    sortedRows,
    nameMap,
    documentLineDescriptionMap,
    documentFiscalNoMap,
    accountReportConfig
  );
  const displayedReportRows = top ? allReportRows.slice(0, top) : allReportRows;
  const summary = buildSummary(allReportRows, displayedReportRows);

  return {
    accountNo,
    currencyCode: accountReportConfig.currencyCode,
    clientSearch,
    from,
    to,
    top,
    summary,
    rows: displayedReportRows,
  };
}

async function buildLedgerReport(options = {}) {
  const accountNo = normalizeString(options.accountNo) || config.accountNo;
  const clientSearch = normalizeString(options.clientSearch);
  const from = normalizeString(options.from);
  const to = normalizeString(options.to);
  const top = normalizeTop(options.top);
  const signal = options.signal;
  let nameMap;
  let ledgerRows;

  if (clientSearch) {
    const result = await fetchLedgerRowsForClient({ accountNo, clientSearch, from, to, signal });
    nameMap = result.nameMap;
    ledgerRows = result.rows;
  } else {
    if (!from || !to) {
      throw new Error("Use client search, or provide both from and to dates.");
    }

    ledgerRows = await fetchLedgerRows({ accountNo, from, to, signal });
    const documentNumbers = ledgerRows.map((row) => row.Document_No);
    const documentNameMap = await fetchDocumentNameMap(documentNumbers, signal);
    const fallbackCustomerMap = await fetchFallbackCustomerMap(documentNumbers, signal);
    nameMap = mergeMaps(documentNameMap, fallbackCustomerMap);
  }

  return buildLedgerReportFromRows({
    accountNo,
    clientSearch,
    from,
    to,
    top,
    ledgerRows,
    nameMap,
    signal,
  });
}

async function buildLedgerReports(options = {}) {
  const accountNos = normalizeAccountNumbers(options.accountNos || DEFAULT_REPORT_ACCOUNTS);
  const clientSearch = normalizeString(options.clientSearch);
  const from = normalizeString(options.from);
  const to = normalizeString(options.to);
  const top = normalizeTop(options.top);
  const signal = options.signal;

  if (clientSearch) {
    const documentNameMap = await fetchMatchingDocumentNameMap({ clientSearch, from, to, signal });
    const documentNumbers = [...documentNameMap.keys()];

    return Promise.all(
      accountNos.map(async (accountNo) => {
        const ledgerRows = await fetchLedgerRowsForDocumentNumbers({
          accountNo,
          from,
          to,
          documentNumbers,
          signal,
        });

        return buildLedgerReportFromRows({
          accountNo,
          clientSearch,
          from,
          to,
          top,
          ledgerRows,
          nameMap: documentNameMap,
          signal,
        });
      })
    );
  }

  return Promise.all(
    accountNos.map((accountNo) =>
      buildLedgerReport({
        ...options,
        accountNo,
      })
    )
  );
}

module.exports = {
  buildLedgerReport,
  buildLedgerReports,
};
