import { readSheet } from "read-excel-file/universal";
import writeXlsxFile from "write-excel-file/universal";
import type { SheetData } from "write-excel-file/universal";
import type {
    CategoryWithEntries,
    ParsedImport
} from "./types";

export async function parseLegacyWorkbook(
    buffer: ArrayBuffer,
    defaultFirstConsumedAt: number | null
): Promise<ParsedImport> {
    const rows = await readSheet(buffer);
    const headers = rows[0] ?? [];
    const entries = [];

    for (let column = 0; column < headers.length; column += 1) {
        const categoryName = String(headers[column] ?? "").trim();
        if (!categoryName) {
            continue;
        }

        for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
            const name = String(rows[rowIndex]?.[column] ?? "").trim();
            if (!name) {
                continue;
            }

            entries.push({
                categoryName,
                name,
                rankPosition: rowIndex - 1,
                firstConsumedAt: defaultFirstConsumedAt
            });
        }
    }

    if (entries.length === 0) {
        throw new Error("Spreadsheet contains no importable entries. Put category names in the first row and entries below them.");
    }

    return { entries };
}

export async function writeExportWorkbook(categories: CategoryWithEntries[]): Promise<Blob> {
    const entryCount = categories.reduce((count, category) => count + category.entries.length, 0);
    if (entryCount === 0) {
        throw new Error("Export requires at least one entry");
    }

    const entryMetadata = categories.flatMap((category) =>
        category.entries.map((entry) => ({
            category: category.name,
            entry: entry.name,
            rank_position: entry.rankPosition,
            created_at: entry.createdAt,
            first_consumed_at: entry.firstConsumedAt
        }))
    );

    const workbook = writeXlsxFile([
        { sheet: "Sorted", data: sortedSheetData(categories) },
        { sheet: "Entry Metadata", data: objectSheetData(entryMetadata) }
    ]);

    return workbook.toBlob();
}

function sortedSheetData(categories: CategoryWithEntries[]): SheetData {
    const data: SheetData = [];

    categories.forEach((category, categoryIndex) => {
        setCell(data, 0, categoryIndex, category.name);

        category.entries.forEach((entry, entryIndex) => {
            setCell(data, entryIndex + 1, categoryIndex, entry.name);
        });
    });

    return data;
}

function setCell(data: SheetData, rowIndex: number, columnIndex: number, value: string) {
    const row = data[rowIndex] ?? (data[rowIndex] = []);
    row[columnIndex] = value;
}

function objectSheetData(rows: Record<string, string | number | null>[]): SheetData {
    const headers = Object.keys(rows[0] ?? {});

    if (headers.length === 0) {
        return [];
    }

    return [
        headers,
        ...rows.map((row) => headers.map((header) => row[header] ?? ""))
    ];
}
