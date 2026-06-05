import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseLegacyWorkbook, writeExportWorkbook } from "../src/lib/importExport";
import type { CategoryWithEntries, Entry } from "../src/lib/types";

describe("xlsx export", () => {
    it("does not write blank padding cells in shorter category columns", async () => {
        const buffer = await writeExportWorkbook([
            category("Books", [entry("Dune", 0)]),
            category("Movies", [
                entry("Alien", 0),
                entry("Arrival", 1),
                entry("Heat", 2)
            ])
        ]);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.getWorksheet("Sorted");

        expect(sheet?.getCell(1, 1).value).toBe("Books");
        expect(sheet?.getCell(2, 1).value).toBe("Dune");
        expect(sheet?.getCell(3, 1).value).toBeNull();
        expect(sheet?.getCell(4, 1).value).toBeNull();
        expect(sheet?.getCell(4, 2).value).toBe("Heat");
    });

    it("rejects exports with no entries", async () => {
        await expect(writeExportWorkbook([category("Books", [])])).rejects.toThrow("at least one entry");
    });
});

describe("xlsx import", () => {
    it("rejects spreadsheets with no importable entries", async () => {
        const workbook = new ExcelJS.Workbook();
        workbook.addWorksheet("Blank");
        const buffer = await workbook.xlsx.writeBuffer();

        await expect(parseLegacyWorkbook(buffer, null)).rejects.toThrow("no importable entries");
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
