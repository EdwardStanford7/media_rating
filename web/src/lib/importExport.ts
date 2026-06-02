import ExcelJS from "exceljs";
import type {
    CategoryWithEntries,
    ParsedImport
} from "./types";

export async function parseLegacyWorkbook(
    buffer: ArrayBuffer,
    defaultFirstConsumedAt: number | null
): Promise<ParsedImport> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    const headers = rowValues(sheet.getRow(1));
    const entries = [];

    for (let column = 0; column < headers.length; column += 1) {
        const categoryName = String(headers[column] ?? "").trim();
        if (!categoryName) {
            continue;
        }

        for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
            const values = rowValues(sheet.getRow(rowNumber));
            const name = String(values[column] ?? "").trim();
            if (!name) {
                continue;
            }

            entries.push({
                categoryName,
                name,
                rankPosition: rowNumber - 2,
                firstConsumedAt: defaultFirstConsumedAt
            });
        }
    }

    return { entries };
}

export async function writeExportWorkbook(categories: CategoryWithEntries[]) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Rankings";
    workbook.created = new Date();

    const sortedSheet = workbook.addWorksheet("Sorted");
    writeSortedSheet(sortedSheet, categories);

    const entryMetadata = categories.flatMap((category) =>
        category.entries.map((entry) => ({
            category: category.name,
            entry: entry.name,
            rank_position: entry.rankPosition,
            created_at: entry.createdAt,
            first_consumed_at: entry.firstConsumedAt
        }))
    );
    addObjectSheet(workbook, "Entry Metadata", entryMetadata);

    return workbook.xlsx.writeBuffer();
}

function writeSortedSheet(sheet: ExcelJS.Worksheet, categories: CategoryWithEntries[]) {
    categories.forEach((category, categoryIndex) => {
        const column = categoryIndex + 1;
        sheet.getCell(1, column).value = category.name;

        category.entries.forEach((entry, entryIndex) => {
            sheet.getCell(entryIndex + 2, column).value = entry.name;
        });
    });
}

function rowValues(row: ExcelJS.Row) {
    const values = Array.isArray(row.values) ? row.values : [];
    return values.slice(1);
}

function addObjectSheet(
    workbook: ExcelJS.Workbook,
    name: string,
    rows: Record<string, unknown>[]
) {
    const sheet = workbook.addWorksheet(name);
    const headers = Object.keys(rows[0] ?? {});

    if (headers.length === 0) {
        return;
    }

    sheet.addRow(headers);
    for (const row of rows) {
        sheet.addRow(headers.map((header) => row[header] ?? ""));
    }
}
