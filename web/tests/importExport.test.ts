import { readSheet } from "read-excel-file/universal";
import writeXlsxFile from "write-excel-file/universal";
import { describe, expect, it } from "vitest";
import { parseLegacyWorkbook, writeExportWorkbook } from "../src/lib/importExport";
import type { CategoryWithEntries, Entry } from "../src/lib/types";

describe("xlsx export", () => {
    it("does not write blank padding cells in shorter category columns", async () => {
        const blob = await writeExportWorkbook([
            category("Books", [entry("Dune", 0)]),
            category("Movies", [
                entry("Alien", 0),
                entry("Arrival", 1),
                entry("Heat", 2)
            ])
        ]);

        const rows = await readSheet(await blob.arrayBuffer(), "Sorted");

        expect(rows[0]?.[0]).toBe("Books");
        expect(rows[1]?.[0]).toBe("Dune");
        expect(rows[2]?.[0] ?? null).toBeNull();
        expect(rows[3]?.[0] ?? null).toBeNull();
        expect(rows[3]?.[1]).toBe("Heat");
    });

    it("rejects exports with no entries", async () => {
        await expect(writeExportWorkbook([category("Books", [])])).rejects.toThrow("at least one entry");
    });
});

describe("xlsx import", () => {
    it("rejects spreadsheets with no importable entries", async () => {
        const blob = await writeXlsxFile([{ sheet: "Blank", data: [] }]).toBlob();

        await expect(parseLegacyWorkbook(await blob.arrayBuffer(), null)).rejects.toThrow("no importable entries");
    });
});

function category(name: string, entries: Entry[]): CategoryWithEntries {
    return {
        id: name.toLowerCase(),
        name,
        sortOrder: 0,
        createdAt: 0,
        isPublic: false,
        entries
    };
}

function entry(name: string, rankPosition: number): Entry {
    return {
        id: name.toLowerCase(),
        categoryId: "category",
        name,
        rankPosition,
        imageKey: null,
        createdAt: 0,
        firstConsumedAt: null
    };
}
