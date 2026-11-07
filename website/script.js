const fileInput = document.querySelector("#html-file");
const fileStatus = document.querySelector("#file-status");
const convertButton = document.querySelector("#convert-button");
const downloadLink = document.querySelector("#download-link");
let downloadUrl;

const datePatterns = [
  /\b(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[T\s])/,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/,
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i
];

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(value) {
  const text = String(value ?? "").trim();
  let match = datePatterns[0].exec(text);
  if (match) {
    return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = datePatterns[1].exec(text);
  if (match) {
    return validDate(Number(match[3]), Number(match[1]), Number(match[2]));
  }

  match = datePatterns[2].exec(text);
  if (match) {
    return validDate(Number(match[3]), new Date(`${match[1]} 1, 2000`).getMonth() + 1, Number(match[2]));
  }

  match = datePatterns[3].exec(text);
  if (match) {
    return validDate(Number(match[3]), new Date(`${match[2]} 1, 2000`).getMonth() + 1, Number(match[1]));
  }

  return "";
}

function parseTime(value) {
  const text = String(value ?? "").trim();
  const match = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(text);
  if (match) {
    let hour = Number(match[1]) % 12;
    if (match[3].toLowerCase().startsWith("p")) {
      hour += 12;
    }
    return `${String(hour).padStart(2, "0")}:${match[2] || "00"}`;
  }

  const twentyFourHour = /(?:\b|T)([01]\d|2[0-3]):([0-5]\d)\b/i.exec(text);
  return twentyFourHour ? `${twentyFourHour[1]}:${twentyFourHour[2]}` : "";
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatGoogleDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Could not read event date: ${date || "(empty)"}`);
  }
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

function formatGoogleTime(time) {
  if (!time) {
    return "";
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    throw new Error(`Could not read event time: ${time}`);
  }
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

function csvCell(value) {
  const safeValue = String(value ?? "");
  const protectedValue = /^[\s]*[=+\-@]/.test(safeValue) ? `'${safeValue}` : safeValue;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

function createGoogleCalendarCsv(events) {
  const headers = [
    "Subject",
    "Start Date",
    "Start Time",
    "End Date",
    "End Time",
    "All Day Event",
    "Description",
    "Location",
    "Private"
  ];
  const rows = events.map((event) => [
    event.title,
    formatGoogleDate(event.startDate),
    event.allDay ? "" : formatGoogleTime(event.startTime),
    event.endDate ? formatGoogleDate(event.endDate) : "",
    event.allDay ? "" : formatGoogleTime(event.endTime),
    event.allDay ? "True" : "False",
    event.description,
    event.location,
    "False"
  ].map(csvCell).join(","));

  return `\uFEFF${[headers.map(csvCell).join(","), ...rows].join("\r\n")}`;
}

function readEventProperties(element) {
  const properties = {};
  for (const name of ["name", "startDate", "endDate", "startTime", "endTime", "description", "location"]) {
    const property = element.querySelector(`[itemprop="${name}"]`);
    properties[name] = property
      ? property.getAttribute("content") || property.getAttribute("datetime") || cleanText(property.textContent)
      : "";
  }

  const start = properties.startDate || "";
  const end = properties.endDate || "";
  return {
    title: properties.name,
    startDate: parseDate(start),
    startTime: parseTime(start) || parseTime(properties.startTime),
    endDate: parseDate(end),
    endTime: parseTime(end) || parseTime(properties.endTime),
    allDay: !parseTime(start) && !parseTime(properties.startTime),
    description: properties.description,
    location: properties.location
  };
}

function eventsFromStructuredData(document) {
  const events = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.some((type) => typeof type === "string" && /event$/i.test(type))) {
      const start = String(value.startDate ?? "");
      const end = String(value.endDate ?? "");
      events.push({
        title: cleanText(value.name),
        startDate: parseDate(start),
        startTime: parseTime(start),
        endDate: parseDate(end),
        endTime: parseTime(end),
        allDay: !parseTime(start),
        description: cleanText(value.description),
        location: cleanText(typeof value.location === "string" ? value.location : value.location?.name)
      });
    }

    Object.values(value).forEach(visit);
  };

  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent));
    } catch {
      // Ignore malformed embedded JSON-LD and continue with other local extraction methods.
    }
  }
  return events;
}

function eventFromRow(row) {
  const cells = Array.from(row.cells);
  if (cells.length < 2) {
    return null;
  }

  const values = cells.map((cell) => cleanText(cell.textContent));
  const table = row.closest("table");
  const headerRow = table?.querySelector("thead tr") || Array.from(table?.rows || []).find((tableRow) =>
    tableRow !== row && Array.from(tableRow.cells).some((cell) => cell.tagName === "TH"));
  const headers = headerRow ? Array.from(headerRow.cells, (cell) => cleanText(cell.textContent).toLowerCase()) : [];
  const dateIndex = values.findIndex((value, index) =>
    parseDate(value) ||
    parseDate(cells[index].getAttribute("datetime")) ||
    parseDate(cells[index].getAttribute("data-date")) ||
    parseDate(cells[index].getAttribute("data-start-date")) ||
    parseDate(cells[index].querySelector("time[datetime]")?.getAttribute("datetime")));
  const dateText = dateIndex >= 0
    ? parseDate(values[dateIndex]) ? values[dateIndex] :
      cells[dateIndex].getAttribute("datetime") ||
      cells[dateIndex].getAttribute("data-date") ||
      cells[dateIndex].getAttribute("data-start-date") ||
      cells[dateIndex].querySelector("time[datetime]")?.getAttribute("datetime") ||
      ""
    : "";
  const startDate = parseDate(dateText);

  if (!startDate) {
    return null;
  }

  const titleIndex = headers.findIndex((header) => /\b(title|event|course|class|subject|activity|assignment)\b/.test(header));
  const startTimeIndex = headers.findIndex((header) => /\b(start\s*time|time)\b/.test(header));
  const endTimeIndex = headers.findIndex((header) => /\bend\s*time\b/.test(header));
  const locationIndex = headers.findIndex((header) => /\b(location|room|building|venue)\b/.test(header));
  const titleCandidates = values
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => value && index !== dateIndex && index !== startTimeIndex && index !== endTimeIndex && index !== locationIndex)
    .filter(({ value }) => !parseDate(value) && !parseTimeOnly(value));
  const title = titleIndex >= 0 && values[titleIndex]
    ? values[titleIndex]
    : titleCandidates[0]?.value;
  if (!title) {
    return null;
  }

  const startTime = parseTime(
    (startTimeIndex >= 0 ? values[startTimeIndex] : "") ||
    cells.map((cell) => cell.getAttribute("datetime") || cell.getAttribute("data-time") || cleanText(cell.textContent)).join(" ")
  );
  const endTime = endTimeIndex >= 0 ? parseTime(values[endTimeIndex]) : "";
  const excludedIndices = new Set([dateIndex, titleIndex, startTimeIndex, endTimeIndex, locationIndex]);
  const description = values.filter((value, index) => value && !excludedIndices.has(index)).join(" | ");

  return {
    title,
    startDate,
    startTime,
    endDate: "",
    endTime,
    allDay: !startTime,
    description,
    location: locationIndex >= 0 ? values[locationIndex] : ""
  };
}

function getWeekdayIndex(header) {
  const day = cleanText(header).toLowerCase().replace(/[^a-z]/g, "").slice(0, 3);
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(day);
}

function getMonthYearContext(table) {
  const monthNames = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8, sept: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11
  };
  const monthYearPattern = /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept?|october|oct|november|nov|december|dec)\.?\s+(\d{4})\b/gi;
  const parts = [table.getAttribute("aria-label") || "", table.getAttribute("summary") || ""];
  const caption = table.caption?.textContent;
  if (caption) {
    parts.push(caption);
  }

  let sibling = table.previousElementSibling;
  while (sibling) {
    if (/^H[1-6]$/.test(sibling.tagName)) {
      parts.push(sibling.textContent);
      break;
    }
    sibling = sibling.previousElementSibling;
  }

  const parent = table.parentElement;
  if (parent) {
    const headings = Array.from(parent.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    const precedingHeading = headings.filter((heading) =>
      heading.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
    if (precedingHeading) {
      parts.push(precedingHeading.textContent);
    }
  }

  const context = parts.join(" ");
  const matches = Array.from(context.matchAll(monthYearPattern));
  if (matches.length === 0) {
    return null;
  }

  const latest = matches[matches.length - 1];
  return { month: monthNames[latest[1].toLowerCase().replace(/\.$/, "")], year: Number(latest[2]) };
}

function getGridCellDate(cell, weekdayIndex, monthYear) {
  const explicitDate = cell.getAttribute("datetime") ||
    cell.getAttribute("data-date") ||
    cell.getAttribute("data-start-date") ||
    cell.querySelector("time[datetime]")?.getAttribute("datetime") ||
    cell.querySelector("[data-date]")?.getAttribute("data-date");
  const parsedExplicitDate = parseDate(explicitDate);
  if (parsedExplicitDate) {
    return parsedExplicitDate;
  }

  const dayMarker = cell.querySelector("[data-day], .day-number, .date-number, .calendar-day-number");
  const markedDay = dayMarker?.getAttribute("data-day") || dayMarker?.textContent;
  const dayMatch = /^(\d{1,2})\b/.exec(cleanText(markedDay || cell.textContent));
  if (!dayMatch) {
    return "";
  }

  const day = Number(dayMatch[1]);
  if (day < 1 || day > 31) {
    return "";
  }

  const context = monthYear || getMonthYearContext(cell.closest("table"));
  if (!context) {
    return "";
  }

  for (const monthOffset of [0, -1, 1]) {
    const monthStart = new Date(Date.UTC(context.year, context.month + monthOffset, 1));
    const candidate = validDate(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, day);
    if (candidate && new Date(`${candidate}T00:00:00Z`).getUTCDay() === weekdayIndex) {
      return candidate;
    }
  }
  return "";
}

function getGridCellEventTexts(cell, dayNumber) {
  const clone = cell.cloneNode(true);
  clone.querySelectorAll("[data-day], .day-number, .date-number, .calendar-day-number").forEach((marker) => marker.remove());
  clone.querySelectorAll("time[datetime]").forEach((time) => {
    if (!cleanText(time.textContent)) {
      time.remove();
    }
  });
  clone.querySelectorAll("br, li, p, div, article, a").forEach((element) => {
    element.insertAdjacentText("beforebegin", "\n");
    element.insertAdjacentText("afterend", "\n");
  });

  const text = clone.textContent
    .split(/\r?\n/)
    .map((line) => cleanText(line).replace(new RegExp(`^${dayNumber}\\b\\s*`), "").trim())
    .filter((line) => line.length > 1 && !/^(?:\d{1,2})$/.test(line));

  return Array.from(new Set(text));
}

function eventsFromWeekdayGridTables(document) {
  const events = [];
  for (const table of document.querySelectorAll("table")) {
    const rows = Array.from(table.rows);
    const weekdayHeader = rows.find((row) =>
      Array.from(row.cells).filter((cell) => getWeekdayIndex(cell.textContent) >= 0).length >= 5);
    if (!weekdayHeader) {
      continue;
    }

    const weekdays = Array.from(weekdayHeader.cells, (cell) => getWeekdayIndex(cell.textContent));
    const monthYear = getMonthYearContext(table);
    const headerIndex = rows.indexOf(weekdayHeader);
    for (const row of rows.slice(headerIndex + 1)) {
      for (let columnIndex = 0; columnIndex < weekdays.length; columnIndex += 1) {
        const weekdayIndex = weekdays[columnIndex];
        const cell = row.cells[columnIndex];
        if (weekdayIndex < 0 || !cell) {
          continue;
        }

        const startDate = getGridCellDate(cell, weekdayIndex, monthYear);
        if (!startDate) {
          continue;
        }

        const dayNumber = Number(startDate.slice(-2));
        for (const text of getGridCellEventTexts(cell, dayNumber)) {
          const startTime = parseTime(text);
          const title = text
            .replace(datePatterns[0], "")
            .replace(datePatterns[1], "")
            .replace(datePatterns[2], "")
            .replace(datePatterns[3], "")
            .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/ig, "")
            .replace(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g, "")
            .replace(/\b(?:at|from|to|until)\b/ig, "")
            .replace(/[|,;:\s-]+/g, " ")
            .trim();

          if (title.length < 2) {
            continue;
          }
          events.push({
            title,
            startDate,
            startTime,
            endDate: "",
            endTime: "",
            allDay: !startTime,
            description: "",
            location: ""
          });
        }
      }
    }
  }
  return events;
}

function getWeekRange(value, year) {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\s*[-–—]\s*(?:(\d{1,2})\/)?(\d{1,2})\s*$/.exec(cleanText(value));
  if (!match) {
    return null;
  }

  const startMonth = Number(match[1]);
  const startDay = Number(match[2]);
  const endMonth = Number(match[3] || match[1]);
  const endDay = Number(match[4]);
  let endYear = year;
  if (endMonth < startMonth) {
    endYear += 1;
  }

  const startDate = validDate(year, startMonth, startDay);
  const endDate = validDate(endYear, endMonth, endDay);
  if (!startDate || !endDate || startDate > endDate) {
    return null;
  }

  return { startDate, endDate };
}

function getScheduleYear(table) {
  const parts = [table.getAttribute("aria-label") || "", table.getAttribute("summary") || "", table.caption?.textContent || ""];
  let sibling = table.previousElementSibling;
  while (sibling) {
    if (/^H[1-6]$/.test(sibling.tagName)) {
      parts.push(sibling.textContent);
      break;
    }
    sibling = sibling.previousElementSibling;
  }

  const matches = Array.from(parts.join(" ").matchAll(/\b(19|20)\d{2}\b/g));
  return matches.length > 0
    ? { year: Number(matches[matches.length - 1][0]), inferred: false }
    : { year: new Date().getFullYear(), inferred: true };
}

function eventTextsFromWeeklyCell(cell) {
  const paragraphs = Array.from(cell.querySelectorAll("p"))
    .flatMap((paragraph) => paragraph.innerHTML.split(/(?:<br\s*\/?>\s*){2,}/i))
    .map((markup) => {
      const container = cell.ownerDocument.createElement("div");
      container.innerHTML = markup;
      return cleanText(container.textContent);
    })
    .filter((text) => text.length > 1);
  if (paragraphs.length > 0) {
    return paragraphs;
  }

  return cell.innerHTML.includes("<br")
    ? cell.innerHTML.split(/<br\s*\/?>/i).map((part) => cleanText(part.replace(/<[^>]*>/g, " "))).filter((text) => text.length > 1)
    : [cleanText(cell.textContent)].filter((text) => text.length > 1);
}

function eventsFromWeeklyScheduleTables(document) {
  const events = [];
  for (const table of document.querySelectorAll("table")) {
    const rows = Array.from(table.rows);
    const weekdayHeader = rows.find((row) =>
      Array.from(row.cells).filter((cell) => getWeekdayIndex(cell.textContent) >= 0).length >= 2);
    if (!weekdayHeader) {
      continue;
    }

    const weekdays = Array.from(weekdayHeader.cells, (cell) => getWeekdayIndex(cell.textContent));
    const headerIndex = rows.indexOf(weekdayHeader);
    const scheduleYear = getScheduleYear(table);
    for (const row of rows.slice(headerIndex + 1)) {
      const weekRangeIndex = Array.from(row.cells).findIndex((cell) => getWeekRange(cell.textContent, scheduleYear.year));
      if (weekRangeIndex < 0) {
        continue;
      }

      const weekRange = getWeekRange(row.cells[weekRangeIndex].textContent, scheduleYear.year);
      const weekStart = new Date(`${weekRange.startDate}T00:00:00Z`);
      const weekEnd = new Date(`${weekRange.endDate}T00:00:00Z`);
      const weekNumber = cleanText(row.cells[0]?.textContent);
      const topic = cleanText(row.cells[weekRangeIndex + 1]?.textContent);

      for (let columnIndex = 0; columnIndex < weekdays.length; columnIndex += 1) {
        const weekdayIndex = weekdays[columnIndex];
        const cell = row.cells[columnIndex];
        if (weekdayIndex < 0 || !cell) {
          continue;
        }

        const dayOffset = (weekdayIndex - weekStart.getUTCDay() + 7) % 7;
        const eventDate = new Date(weekStart);
        eventDate.setUTCDate(eventDate.getUTCDate() + dayOffset);
        if (eventDate > weekEnd) {
          continue;
        }

        const startDate = validDate(eventDate.getUTCFullYear(), eventDate.getUTCMonth() + 1, eventDate.getUTCDate());
        const eventTexts = eventTextsFromWeeklyCell(cell);
        if (eventTexts.length === 0) {
          continue;
        }

        for (const text of eventTexts) {
          const startTime = parseTime(text);
          events.push({
            title: text,
            startDate,
            startTime,
            endDate: "",
            endTime: "",
            allDay: !startTime,
            description: [weekNumber ? `Week ${weekNumber}` : "", topic ? `Topic: ${topic}` : ""].filter(Boolean).join(" | "),
            location: "",
            yearInferred: scheduleYear.inferred
          });
        }
      }
    }
  }
  return events;
}

function parseTimeOnly(value) {
  const text = cleanText(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ||
    /^\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)$/i.test(text);
}

function eventsFromTextLines(document) {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, nav, header, footer, table, [itemtype*="Event" i]').forEach((element) => element.remove());
  clone.querySelectorAll("br, tr, li, p, div, section, article, h1, h2, h3, h4").forEach((element) => {
    element.insertAdjacentText("beforebegin", "\n");
    element.insertAdjacentText("afterend", "\n");
  });

  return clone.textContent.split(/\r?\n/).map((line) => {
    const text = cleanText(line);
    const startDate = parseDate(text);
    if (!startDate) {
      return null;
    }

    const title = text
      .replace(datePatterns[0], "")
      .replace(datePatterns[1], "")
      .replace(datePatterns[2], "")
      .replace(datePatterns[3], "")
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/ig, "")
      .replace(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g, "")
      .replace(/\b(?:at|from|to|until)\b/ig, "")
      .replace(/[|,;:\s-]+/g, " ")
      .trim();

    if (title.length < 2) {
      return null;
    }

    return {
      title,
      startDate,
      startTime: parseTime(text),
      endDate: "",
      endTime: "",
      allDay: !parseTime(text),
      description: "",
      location: ""
    };
  }).filter(Boolean);
}

function eventsFromDateElements(document) {
  const events = [];
  for (const element of document.querySelectorAll("[data-start-date], [data-date], time[datetime]")) {
    if (element.closest("table, [itemtype*=\"Event\" i]")) {
      continue;
    }

    const startValue = element.getAttribute("data-start-date") ||
      element.getAttribute("datetime") ||
      element.getAttribute("data-date") ||
      "";
    const startDate = parseDate(startValue);
    if (!startDate) {
      continue;
    }

    const container = element.closest('[class*="event" i], article, li') || element.parentElement;
    if (!container) {
      continue;
    }
    const heading = container.querySelector("h1, h2, h3, h4, [itemprop=\"name\"]");
    const title = cleanText(heading?.textContent || container.textContent)
      .replace(startValue, "")
      .replace(datePatterns[0], "")
      .replace(datePatterns[1], "")
      .replace(datePatterns[2], "")
      .replace(datePatterns[3], "")
      .trim();
    if (title.length < 2) {
      continue;
    }

    const endValue = container.querySelector("[data-end-date], time[datetime][class*=\"end\" i]")?.getAttribute("data-end-date") ||
      container.querySelector("[data-end-date], time[datetime][class*=\"end\" i]")?.getAttribute("datetime") ||
      "";
    events.push({
      title,
      startDate,
      startTime: parseTime(startValue) || parseTime(container.textContent),
      endDate: parseDate(endValue),
      endTime: parseTime(endValue),
      allDay: !parseTime(startValue) && !parseTime(container.textContent),
      description: "",
      location: ""
    });
  }
  return events;
}

function findEvents(html) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const events = [
    ...eventsFromStructuredData(document),
    ...Array.from(document.querySelectorAll('[itemtype*="Event" i]'), readEventProperties),
    ...eventsFromWeeklyScheduleTables(document),
    ...eventsFromDateElements(document),
    ...eventsFromWeekdayGridTables(document),
    ...Array.from(document.querySelectorAll("tr"), eventFromRow).filter(Boolean),
    ...eventsFromTextLines(document)
  ];

  const uniqueEvents = new Map();
  for (const event of events) {
    if (!event.title || !event.startDate) {
      continue;
    }
    const key = [event.title.toLowerCase(), event.startDate, event.startTime, event.endDate, event.endTime].join("|");
    if (!uniqueEvents.has(key)) {
      uniqueEvents.set(key, event);
    }
  }

  return Array.from(uniqueEvents.values()).sort((a, b) =>
    `${a.startDate}T${a.startTime}`.localeCompare(`${b.startDate}T${b.startTime}`));
}

function setDownload(csv, file) {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
  }
  downloadUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const baseName = file.name.replace(/\.(html?)$/i, "") || "calendar";
  downloadLink.href = downloadUrl;
  downloadLink.download = `${baseName}.csv`;
  downloadLink.textContent = `Download ${baseName}.csv`;
  downloadLink.hidden = false;
  downloadLink.click();
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
  }
  downloadLink.hidden = true;
  downloadLink.removeAttribute("href");
  const fileTooLarge = file && file.size > 1_000_000;
  convertButton.disabled = !file || fileTooLarge;
  fileStatus.textContent = fileTooLarge
    ? "Choose an HTML file smaller than 1 MB."
    : file
      ? `Selected: ${file.name}`
      : "No file selected.";
});

convertButton.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    fileStatus.textContent = "Choose an HTML file before converting.";
    convertButton.disabled = true;
    return;
  }

  convertButton.disabled = true;
  fileInput.disabled = true;
  downloadLink.hidden = true;
  fileStatus.textContent = "Scanning the HTML file locally for dated events...";

  try {
    const html = await file.text();
    const events = findEvents(html);
    if (events.length === 0) {
      fileStatus.textContent = "No events were recognized. This converter looks for dated events and weekly schedule tables with date ranges and weekday columns.";
      return;
    }

    setDownload(createGoogleCalendarCsv(events), file);
    const usedInferredYear = events.some((event) => event.yearInferred);
    const yearNote = usedInferredYear
      ? ` The calendar has no year, so ${new Date().getFullYear()} was used.`
      : "";
    fileStatus.textContent = `Found ${events.length} event${events.length === 1 ? "" : "s"} and created the CSV.${yearNote} Review it before importing; local date recognition may miss events in other formats.`;
  } catch (error) {
    fileStatus.textContent = `Could not convert this file: ${error.message}`;
  } finally {
    fileInput.disabled = false;
    convertButton.disabled = !fileInput.files[0] || fileInput.files[0].size > 1_000_000;
  }
});

window.addEventListener("pagehide", () => {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
  }
});
