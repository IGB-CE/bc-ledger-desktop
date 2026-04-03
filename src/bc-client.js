const axios = require("axios");
const { config, assertConfig } = require("./config");

function escapeODataString(value) {
  return String(value).replace(/'/g, "''");
}

function buildEntityUrl(entity, options = {}) {
  const { filter, select, top, skip, orderby } = options;
  const params = new URLSearchParams();

  if (filter) {
    params.set("$filter", filter);
  }

  if (select) {
    params.set("$select", Array.isArray(select) ? select.join(",") : select);
  }

  if (typeof top === "number" || typeof top === "string") {
    params.set("$top", String(top));
  }

  if (typeof skip === "number" || typeof skip === "string") {
    params.set("$skip", String(skip));
  }

  if (orderby) {
    params.set("$orderby", orderby);
  }

  const query = params.toString();
  return query ? `${config.bcBaseUrl}/${entity}?${query}` : `${config.bcBaseUrl}/${entity}`;
}

async function fetchEntity(entity, options = {}) {
  assertConfig();
  const url = buildEntityUrl(entity, options);

  try {
    const response = await axios.get(url, {
      auth: {
        username: config.bcUsername,
        password: config.bcPassword,
      },
      headers: {
        Accept: "application/json",
      },
      signal: options.signal,
      timeout: config.timeoutMs,
    });

    return Array.isArray(response.data?.value) ? response.data.value : [];
  } catch (error) {
    if (axios.isCancel(error) || error?.code === "ERR_CANCELED") {
      const cancellationError = new Error("Search canceled.");
      cancellationError.code = "SEARCH_CANCELED";
      throw cancellationError;
    }

    const status = error?.response?.status;
    const details =
      error?.response?.data?.error?.message?.value ||
      error?.response?.data?.error?.message ||
      error?.message;

    throw new Error(`BC request failed for ${entity} (${status || "no-status"}): ${details}. URL: ${url}`);
  }
}

async function fetchAllEntity(entity, options = {}, pageSize = 200) {
  const allRows = [];
  let skip = 0;

  while (true) {
    const rows = await fetchEntity(entity, {
      ...options,
      top: pageSize,
      skip,
    });

    allRows.push(...rows);

    if (rows.length < pageSize) {
      break;
    }

    skip += pageSize;
  }

  return allRows;
}

function buildOrFilter(fieldName, values, { numeric = false } = {}) {
  const cleaned = [...new Set(values)].filter((value) => value !== undefined && value !== null && value !== "");

  if (cleaned.length === 0) {
    return "";
  }

  return cleaned
    .map((value) => {
      if (numeric) {
        return `${fieldName} eq ${Number(value)}`;
      }

      return `${fieldName} eq '${escapeODataString(value)}'`;
    })
    .join(" or ");
}

function chunkArray(items, chunkSize) {
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

module.exports = {
  buildOrFilter,
  chunkArray,
  escapeODataString,
  fetchEntity,
  fetchAllEntity,
};
