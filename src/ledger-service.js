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

function normalizeString(value) {
  return String(value || "").trim();
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

async function fetchLedgerRows({ accountNo, from, to, documentNumbers = [] }) {
  return fetchAllEntity("G_LEntries", {
    filter: buildLedgerFilter({ accountNo, from, to, documentNumbers }),
    select: ["Entry_No", "Posting_Date", "Document_Date", "Document_No", "Document_Type", "Amount", "Additional_Currency_Amount"],
  });
}

async function fetchFallbackCustomerMap(documentNumbers) {
  const result = new Map();
  const chunks = chunkArray(documentNumbers, 20);

  for (const chunk of chunks) {
    const rows = await fetchEntity("Cust_LedgerEntries", {
      filter: buildOrFilter("Document_No", chunk),
      select: ["Document_No", "Customer_Name"],
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
  const normalized = normalizeString(searchTerm);
  const variants = [...new Set([normalized, normalized.toUpperCase()])].filter(Boolean);

  if (variants.length === 0) {
    return "";
  }

  return variants
    .map((variant) => `contains(${fieldName},'${escapeODataString(variant)}')`)
    .join(" or ");
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

async function fetchMatchingHeaderRows(entity, nameField, { clientSearch, from, to }) {
  const filter = buildHeaderSearchFilter({ fieldName: nameField, clientSearch, from, to });

  return fetchAllEntity(entity, {
    filter,
    select: ["No", nameField, "Posting_Date", "Document_Date"],
  });
}

async function fetchMatchingDocumentNameMap({ clientSearch, from, to }) {
  const result = new Map();
  const invoices = await fetchMatchingHeaderRows("PostedSalesInvoice", "Sell_to_Customer_Name", {
    clientSearch,
    from,
    to,
  });
  const creditMemos = await fetchMatchingHeaderRows("PSCM", "Sell_to_Customer_Name", {
    clientSearch,
    from,
    to,
  });

  for (const row of [...invoices, ...creditMemos]) {
    if (row.No && row.Sell_to_Customer_Name && !result.has(row.No)) {
      result.set(row.No, row.Sell_to_Customer_Name.trim());
    }
  }

  return result;
}

async function fetchHeaderFieldMapForEntity(entity, documentNumbers, fieldName) {
  const result = new Map();
  const uniqueDocumentNumbers = [...new Set(documentNumbers)];
  const chunks = chunkArray(uniqueDocumentNumbers, 20);

  for (const chunk of chunks) {
    const rows = await fetchEntity(entity, {
      filter: buildOrFilter("No", chunk),
      select: ["No", fieldName],
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

async function fetchHeaderNameMapForEntity(entity, documentNumbers) {
  return fetchHeaderFieldMapForEntity(entity, documentNumbers, "Sell_to_Customer_Name");
}

async function fetchDocumentNameMap(documentNumbers) {
  const invoiceMap = await fetchHeaderNameMapForEntity("PostedSalesInvoice", documentNumbers);
  const creditMemoMap = await fetchHeaderNameMapForEntity("PSCM", documentNumbers);

  return new Map([...invoiceMap, ...creditMemoMap]);
}

async function fetchDocumentFiscalNoMap(documentNumbers) {
  const invoiceMap = await fetchHeaderFieldMapForEntity("PSI_Header", documentNumbers, "Document_No_Fiscal");
  const creditMemoMap = await fetchHeaderFieldMapForEntity("PSCM", documentNumbers, "Document_No_Fiscal");

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

async function fetchDocumentLineDescriptionMapForEntity(entity, documentNumbers, select) {
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

async function fetchDocumentLineDescriptionMap(documentNumbers) {
  const invoiceMap = await fetchDocumentLineDescriptionMapForEntity("PostedSalesInvoiceSalesInvLines", documentNumbers, [
    "Document_No",
    "Line_No",
    "Type",
    "No",
    "Long_Description",
    "Description_2",
    "Description",
  ]);
  const creditMemoMap = await fetchDocumentLineDescriptionMapForEntity("PSCM_Lines", documentNumbers, [
    "Document_No",
    "Line_No",
    "Type",
    "No",
    "Description_2",
    "Description",
  ]);

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

async function fetchLedgerRowsForClient({ accountNo, clientSearch, from, to }) {
  const documentNameMap = await fetchMatchingDocumentNameMap({ clientSearch, from, to });
  const documentNumbers = [...documentNameMap.keys()];

  if (documentNumbers.length === 0) {
    return {
      nameMap: documentNameMap,
      rows: [],
    };
  }

  const documentChunks = chunkArray(documentNumbers, 20);
  const ledgerRows = [];

  for (const chunk of documentChunks) {
    const chunkRows = await fetchLedgerRows({
      accountNo,
      from,
      to,
      documentNumbers: chunk,
    });

    ledgerRows.push(...chunkRows);
  }

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

async function buildLedgerReport(options = {}) {
  const accountNo = normalizeString(options.accountNo) || config.accountNo;
  const accountReportConfig = getAccountReportConfig(accountNo);
  const clientSearch = normalizeString(options.clientSearch);
  const from = normalizeString(options.from);
  const to = normalizeString(options.to);
  const top = normalizeTop(options.top);
  let nameMap;
  let ledgerRows;

  if (clientSearch) {
    const result = await fetchLedgerRowsForClient({ accountNo, clientSearch, from, to });
    nameMap = result.nameMap;
    ledgerRows = result.rows;
  } else {
    if (!from || !to) {
      throw new Error("Use client search, or provide both from and to dates.");
    }

    ledgerRows = await fetchLedgerRows({ accountNo, from, to });
    const documentNumbers = ledgerRows.map((row) => row.Document_No);
    const documentNameMap = await fetchDocumentNameMap(documentNumbers);
    const fallbackCustomerMap = await fetchFallbackCustomerMap(documentNumbers);
    nameMap = mergeMaps(documentNameMap, fallbackCustomerMap);
  }

  const sortedRows = sortLedgerRows(ledgerRows);
  const documentNumbers = sortedRows.map((row) => row.Document_No);
  const documentLineDescriptionMap = await fetchDocumentLineDescriptionMap(documentNumbers);
  const documentFiscalNoMap = await fetchDocumentFiscalNoMap(documentNumbers);
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

module.exports = {
  buildLedgerReport,
};
