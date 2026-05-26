import ExcelJS from "exceljs";
import type {
    CategoryWithEntries,
    MatchRecord,
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

export async function writeExportWorkbook(
    categories: CategoryWithEntries[],
    matches: MatchRecord[] = []
) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Media Rating";
    workbook.created = new Date();

    const sortedRows = buildSortedRows(categories);
    const sortedSheet = workbook.addWorksheet("Sorted");
    sortedSheet.addRows(sortedRows);

    const entryMetadata = categories.flatMap((category) =>
        category.entries.map((entry) => ({
            category: category.name,
            entry: entry.name,
            rank_position: entry.rankPosition,
            created_at: entry.createdAt,
            first_consumed_at: entry.firstConsumedAt,
            free_rank_elo: Math.round(entry.freeRankElo),
            free_rank_wins: entry.freeRankWins,
            free_rank_losses: entry.freeRankLosses
        }))
    );
    addObjectSheet(workbook, "Entry Metadata", entryMetadata);

    if (matches.length > 0) {
        addObjectSheet(workbook, "Matches", matches.map((match) => ({ ...match })));
    }

    return workbook.xlsx.writeBuffer();
}

function buildSortedRows(categories: CategoryWithEntries[]) {
    const headers = categories.map((category) => category.name);
    const maxEntries = Math.max(0, ...categories.map((category) => category.entries.length));
    const rows: string[][] = [headers];

    for (let index = 0; index < maxEntries; index += 1) {
        rows.push(
            categories.map((category) => category.entries[index]?.name ?? "")
        );
    }

    return rows;
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
