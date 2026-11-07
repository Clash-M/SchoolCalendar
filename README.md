# SchoolCalendar

## Run the calendar converter

The converter is a static website: it parses the imported HTML locally in your browser and does not upload the file or require an AI key or backend.

- Open `index.html` directly in a browser, or use VS Code Live Server.
- Import the course calendar HTML and select **Find events & create CSV**.
- The converter looks for dated events in HTML tables, including weekly schedule tables with a date-range column and weekday columns. It creates a Google Calendar event for each non-empty paragraph in a weekday cell, preserves the week's topic in each event description, and uses any times found in that paragraph. If the file has no year, the current year is used for its week ranges. Structured event data, date/time elements, and dated text are also supported.
- Weekly schedule cells without a time are exported as all-day events because the source does not specify a time. Review the CSV before importing it into Google Calendar; date and event recognition is local and rule-based.

The app accepts HTML files up to 1 MB. Detected events are downloaded as a Google Calendar-compatible CSV.

