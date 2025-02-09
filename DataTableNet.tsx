/* eslint-disable react-hooks/exhaustive-deps */
"use client"

import React, { useEffect, useRef, useMemo } from "react"
import $ from "jquery"
import "datatables.net-dt"
import "datatables.net-responsive-dt"
import "datatables.net-select-dt"
import "datatables.net-buttons-dt"
import "datatables.net-buttons/js/buttons.html5"
import "datatables.net-buttons/js/buttons.print"

import * as XLSX from "xlsx-js-style"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChevronDown, File, FileSpreadsheet, Search, LineChartIcon as ChartLine, ChevronRight, PlusCircle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { debounce } from "lodash"
import { useUser } from "@/contexts/UserContext"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import ReactDOMServer from "react-dom/server"
import { Api } from "datatables.net-dt"

interface ResponsiveColumn {
    hidden: boolean;
    title: string;
    data: any;
}

interface DatatableNetProps<TData extends Record<string, any> = any, TValue = any> {
    columns: any
    data: TData
    showAllRows?: boolean
    filterColumn?: string
    filterPlaceholder?: string
    selectableRows?: boolean
    onSelectedRowsChange?: (selectedRows: TData[]) => void
    hiddenColumns?: string[]
    year: string
    fromDate: string
    toDate: string
    totalDataSummary: {
        unrealized: number
        realized: number
        liabilities: number
    }
    expensesData: {
        rowKey: string
        rowAmount: string
        rows: any[]
        total: number
    }
    showPagination?: boolean
    downloadFileName?: string
    onAddPortfolio?: (row: any) => void
}

const DatatableNet: React.FC<DatatableNetProps> = ({
    columns,
    data,
    showAllRows = false,
    filterColumn,
    filterPlaceholder = "Filter...",
    year,
    fromDate,
    toDate,
    totalDataSummary,
    expensesData,
    showPagination = true,
    downloadFileName = "data",
    onAddPortfolio
}) => {
    const tableRef = useRef<any>(null)
    const [columnVisibility, setColumnVisibility] = React.useState<{ [key: string]: boolean }>({})

    const [filterValue, setFilterValue] = React.useState("")
    const [isSearchOpen, setIsSearchOpen] = React.useState(false)
    const { userDetails, currentUser } = useUser()

    const groupedData = useMemo(() => {
        if (!data || typeof data !== "object") return []
        return Object.entries(data).map(([key, value]) => {
            const typedValue = value as { sum: number; rows: any[] }
            return {
                category: key,
                sum: typedValue.sum,
                rows: typedValue.rows,
            }
        })
    }, [data])

    const flattenedData = useMemo(
        () => groupedData.flatMap((section) => section.rows.map((row) => ({ ...row, category: section.category }))),
        [groupedData],
    )

    useEffect(() => {
        if (tableRef.current) {
            const dt = $(tableRef.current).DataTable({
                data: flattenedData,
                columns: [
                    {
                        data: null,
                        defaultContent: "",
                        className: "dtr-control",
                        orderable: false,
                        render: (data, type, row) =>
                            ReactDOMServer.renderToString(<ChevronRight className="h-4 w-4 transition-transform" />),
                    },
                    ...columns.map((col) => ({
                        data: col.accessorKey,
                        title: col.header,
                        visible: !col.hidden && !col.deselected,
                        name: col.accessorKey,
                        orderable: col.sortable !== false,
                        render: (data, type, row, meta) => {
                            if (col.cell && typeof col.cell === "function") {
                                const cellContent = col.cell({ row })
                                if (React.isValidElement(cellContent)) {
                                    return ReactDOMServer.renderToString(cellContent)
                                }
                                return cellContent
                            }
                            return data
                        },
                    })),
                ],
                responsive: {
                    details: {
                        type: "column",
                        renderer: (api: Api<any>, rowIdx: number, columns: any) => {
                            const responsiveColumns = columns as ResponsiveColumn[];
                            const data = responsiveColumns.map((col) => {
                                return col.hidden
                                    ? '<tr class="expandable-row">' +
                                    '<td class="font-medium">' +
                                    col.title +
                                    ":</td> " +
                                    "<td>" +
                                    col.data +
                                    "</td>" +
                                    "</tr>"
                                    : ""
                            }).join("")

                            if (!data) return false;

                            const wrapper = document.createElement('div');
                            wrapper.innerHTML = '<table class="expandable-table w-full"><tbody>' + data + '</tbody></table>';
                            return wrapper;
                        }

                    },
                },
                columnDefs: [
                    {
                        className: "dtr-control",
                        orderable: false,
                        targets: 0,
                    },
                    {
                        targets: "_all",
                        orderable: true,
                    },
                    ...columns.map((col, index) => ({
                        targets: index + 1,
                        orderable: col.sortable !== false,
                    })),
                ],
                deferRender: true,
                scrollX: true,
                order: [],
                scrollY: showAllRows ? "800px" : "",
                scrollCollapse: true,
                pageLength: showAllRows ? flattenedData.length : 10,
                ordering: true,
                paging: showPagination,
                info: showPagination,
                lengthChange: showPagination,
                drawCallback: function (settings: any) {
                    const api = new $.fn.dataTable.Api(settings)
                    let lastCategory = null

                    api.rows({ page: "current" }).every(function () {
                        const data = this.data()
                        if (data.category !== lastCategory) {
                            const visibleColumns = api
                                .columns()
                                .indexes()
                                .filter((index) => api.column(index).visible())
                            const categoryRow = createCategoryRow(
                                data.category,
                                groupedData.find((g) => g.category === data.category)?.sum || 0,
                                visibleColumns.length,
                            )
                            $(this.node()).before(categoryRow)
                            lastCategory = data.category
                        }
                    })
                    $(tableRef.current).on("click", ".add-portfolio-btn", function () {
                        const rowData = JSON.parse($(this).attr("data-row") || "")
                        onAddPortfolio?.(rowData)
                    })
                },
            })

            // Initialize column visibility state
            const initialVisibility: { [key: string]: boolean } = {}
            columns.forEach((col) => {
                initialVisibility[col.accessorKey as string] = !col.hidden && !col.deselected
            })
            setColumnVisibility(initialVisibility)

            // Add event listeners for category info tooltips
            $(tableRef.current).on("draw.dt", () => {
                $(".category-info").each(function () {
                    const category = $(this).data("category")
                    const tooltipContent = getCategoryTooltipContent(category)
                    $(this).attr("title", tooltipContent)
                })
            })

            // Add event listener for column visibility changes
            dt.on("column-visibility.dt", (e, settings, column, state) => {
                const columnId = dt.column(column).dataSrc() as string
                setColumnVisibility((prev) => ({ ...prev, [columnId]: state }))
            })

            $("<style>")
                .prop("type", "text/css")
                .html(`
              .category-row {
                background-color: #f3f4f6;
              }
              .category-row:hover {
                background-color: #e5e7eb;
              }
              .expandable-table {
                background-color: #f9fafb;
                border-radius: 0.375rem;
                overflow: hidden;
              }
              .expandable-row td {
                padding: 0.5rem;
                border-bottom: 1px solid #e5e7eb;
              }
              .expandable-row:last-child td {
                border-bottom: none;
              }
              .dtr-control {
                cursor: pointer;
              }
              .dtr-control svg {
                transition: transform 0.2s ease-in-out;
              }
              .dtr-control.expanded svg {
                transform: rotate(90deg);
              }
              ${!showPagination
                        ? `
              .dataTables_info, .dataTables_paginate, .dataTables_length {
                display: none !important;
              }
              `
                        : ""
                    }
            `)
                .appendTo("head")

            // Add event listener to handle icon rotation
            $(tableRef.current).on("responsive-display", (e, datatable, row, showHide, update) => {
                const $row = $(row.node())
                const $control = $row.find(".dtr-control")
                if (showHide) {
                    $control.addClass("expanded")
                } else {
                    $control.removeClass("expanded")
                }
            })

            return () => {
                dt.destroy()
                $(tableRef.current).off("draw.dt")
                $(tableRef.current).off("responsive-display")
                $(tableRef.current).off("click", ".add-portfolio-btn")
            }
        }
    }, [columns, flattenedData, showAllRows, groupedData, showPagination])

    const createCategoryRow = (category: string, sum: number, visibleColumnsCount: number) => {
        const displayCategory = category === "OP_ASSETS" ? "OPENING ASSETS" : category.toUpperCase()
        const sumDisplay = new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
        }).format(Math.abs(sum))
        const profitLossText = sum >= 0 ? "Profit" : "Loss"
        const colorClass = sum >= 0 ? "text-green-600" : "text-red-600"

        return `
            <tr id="${category}" class="category-row">
                <td colspan="${visibleColumnsCount}" class="text-center font-semibold py-2">
                <div class="flex items-center justify-center gap-2">
                    <div >${displayCategory}</div>  
                    <span class="cursor-pointer category-info" data-category="${category}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-info"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                    (
                    <span class="mx-1 ${colorClass}">
                    ${category === "OP_ASSETS" || category === "ASSETS"
                ? `Unrealized ${profitLossText}: `
                : category === "LIABILITIES"
                    ? `LIABILITIES: `
                    : `${profitLossText}: `
            }
                    ${sumDisplay}
                    </span>
                    )
                </div>
                </td>
            </tr>
            `
    }

    const getCategoryTooltipContent = (category: string) => {
        switch (category) {
            case "OP_ASSETS":
                return "Holdings acquired before the beginning of the current financial year. These assets have been carried forward from previous periods and are part of the portfolio's opening balance."
            case "ASSETS":
                return "Holdings purchased during the current financial year. These represent new acquisitions added to the portfolio after the start of the financial year."
            case "SHORTTERM":
                return "The profit earned from selling assets held for a period of less than 12 months, subject to applicable short-term capital gains tax."
            case "LONGTERM":
                return "The profit earned from selling assets held for a period of 12 months or more, typically eligible for preferential tax rates"
            case "LIABILITIES":
                return "Represents stocks that have been sold but lack corresponding buy trade records in the back-office system. This indicates a discrepancy requiring reconciliation to ensure accurate transaction history and financial reporting."
            case "TRADING":
                return "Represents transactions where stocks are bought and sold on the same trading day. These trades are settled without carrying positions overnight and are typically considered for intraday profit or loss calculations."
            default:
                return ""
        }
    }

    const downloadCSV = () => {
        const dt = $(tableRef.current).DataTable();

        // Get visible columns
        const visibleColumns = dt
            .columns()
            .indexes()
            .filter((index) => dt.column(index).visible());

        const columns = dt
            .columns()
            .header()
            .toArray()
            .filter((_, index) => visibleColumns.indexOf(index) !== -1)
            .map((col) => `"${col.textContent}"`);

        const totalColumns = columns.length;

        // Utility functions
        const createCenteredRow = (content: string) => {
            const row = Array(totalColumns).fill("");
            row[Math.floor(totalColumns / 2)] = `"${content}"`;
            return row.join(",");
        };

        const createSpecialRow = (content: string) => {
            return `"${content}"`;
        };

        const formatCurrencyWithColor = (value: number) => {
            return `"${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value)}"`;
        };

        const formatProfitLoss = (value: number, prefix: string) => {
            return `"${prefix} ${value >= 0 ? "Profit" : "Loss"}: ${formatCurrencyWithColor(value)}"`;
        };
        const formatSummaryData = () => {
            const entries = Object.entries(data).map(([category, value]) => {
                const sum = (value as { sum: number }).sum;
                return [category, formatCurrencyWithColor(sum)];
            });
            const result: string[] = [];
            for (let i = 0; i < entries.length; i += 2) {
                const left = entries[i] || ["", ""];
                const right = entries[i + 1] || ["", ""];
                result.push(`"${left[0]}",${left[1]},"","${right[0]}",${right[1]}`);
            }
            return result;
        };

        // CSV Header Rows
        const headerRows = [
            createCenteredRow("Pune e Stock Broking Limited"),
            "",
            createCenteredRow(
                `Name: ${userDetails.clientName}          FINANCIAL YEAR REPORT: ${year}          Date Range: ${fromDate} to ${toDate}          Client ID: ${currentUser}`
            ),
            "",
            createSpecialRow("Summary"),
            ...formatSummaryData(),
            "",
            `"Total Data Summary",${formatProfitLoss(totalDataSummary.unrealized, "Unrealized")},${formatProfitLoss(
                totalDataSummary.realized,
                "Realized"
            )},"Liabilities: ${formatCurrencyWithColor(totalDataSummary.liabilities)}","Expenses: ${formatCurrencyWithColor(
                expensesData.total
            )}"`,
            "",
            createSpecialRow("Expenses"),
            ...expensesData.rows.map((row) => `"${row.BUY_COMPANY_CODE}",${formatCurrencyWithColor(row.PL_AMT)}`),
            `"Total Expenses",${formatCurrencyWithColor(expensesData.total)}`,
            "",
            createCenteredRow("Detailed Report"),
        ];

        // Main Data Rows
        const rows = groupedData.flatMap((section) => {
            const formattedSum = formatCurrencyWithColor(Math.abs(section.sum));
            const categoryDisplay =
                section.category === "OP_ASSETS" || section.category === "ASSETS"
                    ? `Unrealized ${section.sum >= 0 ? "Profit" : "Loss"}: ${formattedSum}`
                    : section.category === "LIABILITIES"
                        ? `LIABILITIES: ${formattedSum}`
                        : `${section.sum >= 0 ? "Profit" : "Loss"}: ${formattedSum}`;

            const centeredCategoryRow = createCenteredRow(
                `${section.category === "OP_ASSETS" ? "OPENING ASSETS" : section.category.toUpperCase()} (${categoryDisplay})`
            );

            const dataRows = section.rows.map((row) =>
                visibleColumns
                    .map((index) => {
                        const columnKey = dt.column(index).dataSrc() as string
                        const value = row[columnKey];
                        return typeof value === "number" ? formatCurrencyWithColor(value) : `"${value || ""}"`;
                    })
                    .join(",")
            );

            return ["", centeredCategoryRow, ...dataRows];
        });

        // CSV Data Compilation
        const csvData = headerRows.concat([columns.join(",")]).concat(rows).join("\n");
        const blob = new Blob(["\ufeff" + csvData], { type: "text/csv;charset=utf-8;" });

        // File Download Logic
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            link.setAttribute("download", `IT_REPORT_EQUITY_${timestamp}.csv`);
            link.style.visibility = "hidden";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const formatCurrency = (value: number) => {
        const formattedValue = new Intl.NumberFormat("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(Math.abs(value))

        return `₹ ${formattedValue}${value < 0 ? " CR" : ""}`
    }

    const downloadPDF = () => {
        const dt = $(tableRef.current).DataTable()

        const visibleColumns = dt
            .columns()
            .indexes()
            .filter((index) => dt.column(index).visible())

        const columns = dt
            .columns()
            .header()
            .toArray()
            .filter((_, index) => visibleColumns.indexOf(index) !== -1)
            .map((col) => col.textContent)

        const doc = new jsPDF()
        doc.addFont(
            "https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf",
            "Roboto",
            "normal",
        )
        doc.setFont("Roboto")
        let currentY = 10

        // Set font to support Unicode characters
        doc.setFont("helvetica")

        // Header
        doc.setFontSize(16)
        doc.text("Pune e Stock Broking Limited", doc.internal.pageSize.width / 2, currentY, { align: "center" })
        currentY += 10

        doc.setFontSize(12)
        doc.text(
            `Name: ${userDetails.clientName}    FINANCIAL YEAR REPORT: ${year}    Date Range: ${fromDate} to ${toDate}    Client ID: ${currentUser}`,
            10,
            currentY,
        )
        currentY += 10

        doc.text("Summary", 10, currentY)
        currentY += 8
        // Format Summary Data
        const summaryRows = Object.entries(data).map(([category, value]) => {
            const sum = (value as { sum: number }).sum
            return [category, formatCurrency(sum)]
        })

        autoTable(doc, {
            startY: currentY,
            head: [["Category", "Amount"]],
            body: summaryRows,
        })

        currentY = (doc as any).lastAutoTable.finalY + 10

        // Total Data Summary
        doc.text("Total Data Summary", 10, currentY)
        currentY += 8

        const totalDataSummaryRows = [
            [
                "Unrealized",
                `${totalDataSummary.unrealized >= 0 ? "Profit" : "Loss"}: ${formatCurrency(totalDataSummary.unrealized)}`,
            ],
            ["Realized", `${totalDataSummary.realized >= 0 ? "Profit" : "Loss"}: ${formatCurrency(totalDataSummary.realized)}`],
            ["Liabilities", formatCurrency(totalDataSummary.liabilities)],
            ["Expenses", formatCurrency(expensesData.total)],
        ]

        autoTable(doc, {
            startY: currentY,
            body: totalDataSummaryRows,
        })

        currentY = (doc as any).lastAutoTable.finalY + 10

        // Expenses Section
        doc.text("Expenses", 10, currentY)
        currentY += 8
        const expenseRows = expensesData.rows.map((row) => [row[expensesData.rowKey], formatCurrency(row[expensesData.rowAmount])])

        expenseRows.push(["Total Expenses", formatCurrency(expensesData.total)])

        autoTable(doc, {
            startY: currentY,
            head: [["Company Code", "Amount"]],
            body: expenseRows,
        })

        currentY = (doc as any).lastAutoTable.finalY + 10

        // Detailed Report
        doc.text("Detailed Report", 10, currentY)
        currentY += 8

        groupedData.forEach((section) => {
            const formattedSum = formatCurrency(Math.abs(section.sum))
            const categoryDisplay =
                section.category === "OP_ASSETS" || section.category === "ASSETS"
                    ? `Unrealized ${section.sum >= 0 ? "Profit" : "Loss"}: ${formattedSum}`
                    : section.category === "LIABILITIES"
                        ? `LIABILITIES: ${formattedSum}`
                        : `${section.sum >= 0 ? "Profit" : "Loss"}: ${formattedSum}`

            doc.text(`${section.category.toUpperCase()} (${categoryDisplay})`, 10, currentY)
            currentY += 8

            const sectionRows = section.rows.map((row) =>
                columns.map((_, index) => {
                    const columnKey = dt.column(index).dataSrc() as string
                    const value = row[columnKey]
                    return typeof value === "number" ? formatCurrency(value) : value || ""
                }),
            )

            autoTable(doc, {
                startY: currentY,
                head: [columns],
                body: sectionRows,
            })

            currentY = (doc as any).lastAutoTable.finalY + 10
        })

        // Save PDF
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
        const filename = `${downloadFileName}_${timestamp}.pdf`
        doc.save(filename)
    }

    const downloadExcel = () => {
        const dt = $(tableRef.current).DataTable()
        const visibleColumns = dt
            .columns()
            .indexes()
            .filter((index) => dt.column(index).visible())
        const columnsData = columns.filter((_, index) => visibleColumns.indexOf(index) !== -1)
        const totalColumns = columnsData.length

        const createCenteredRow = (content: string, isMerged = true) => {
            const row = Array(totalColumns).fill("")
            row[0] = content
            return { data: row, isMerged }
        }

        const createSpecialRow = (content: string) => {
            return { data: [content], isSpecial: true }
        }

        const formatCurrencyWithColor = (value: number) => {
            const formattedValue = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value)
            return {
                v: formattedValue,
                s: {
                    font: { color: { rgb: value >= 0 ? "008000" : "FF0000" } },
                },
            }
        }

        const formatProfitLoss = (value: number, prefix: string) => {
            const formattedValue = formatCurrencyWithColor(value)
            return {
                v: `${prefix} ${value >= 0 ? "Profit" : "Loss"}: ${formattedValue.v}`,
                s: {
                    alignment: { horizontal: "left" },
                },
            }
        }

        const formatCurrency = (value: number) =>
            new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value)

        const formatSummaryData = () => {
            const entries = Object.entries(data).map(([category, value]) => {
                const sum = (value as { sum: number }).sum
                return [category, formatCurrencyWithColor(sum)]
            })

            const result: string[][] = []
            for (let i = 0; i < entries.length; i += 2) {
                const left = entries[i] || ["", ""]
                const right = entries[i + 1] || ["", ""]
                result.push([left[0] as string, left[1] as string, "", right[0] as string, right[1] as string])
            }
            return result
        }

        const headerData = [
            createCenteredRow("Pune e Stock Broking Limited"),
            createCenteredRow(""),
            createCenteredRow(
                `Name: ${userDetails.clientName}          FINANCIAL YEAR REPORT: ${year}          Date Range: ${fromDate} to ${toDate}          Client ID: ${currentUser}`,
            ),
            [],
            createSpecialRow("Summary"),
            ...formatSummaryData(),
            [],
            {
                data: [
                    "Total Data Summary",
                    formatProfitLoss(totalDataSummary.unrealized, "Unrealized"),
                    formatProfitLoss(totalDataSummary.realized, "Realized"),
                    {
                        v: `Liabilities: ${formatCurrency(totalDataSummary.liabilities)}`,
                        s: { alignment: { horizontal: "left" } },
                    },
                    { v: `Expenses: ${formatCurrency(expensesData.total)}`, s: { alignment: { horizontal: "left" } } },
                ],
                isMerged: false,
                isSpecial: true,
            },
            [],
            createSpecialRow("Expenses"),
            ...expensesData.rows.map((row) => [row[expensesData.rowKey], formatCurrencyWithColor(row[expensesData.rowAmount])]),
            ["Total Expenses", formatCurrencyWithColor(expensesData.total)],
            [],
            createCenteredRow("Detailed Report"),
        ]

        const rows = groupedData.flatMap((section) => {
            const formattedSum = formatProfitLoss(Math.abs(section.sum), "")
            const categoryDisplay =
                section.category === "OP_ASSETS" || section.category === "ASSETS"
                    ? `Unrealized ${section.sum >= 0 ? "Profit" : "Loss"}: ${formattedSum.v}`
                    : section.category === "LIABILITIES"
                        ? `LIABILITIES: ${formattedSum.v}`
                        : `${section.sum >= 0 ? "Profit" : "Loss"}: ${formattedSum.v}`

            const centeredCategoryRow = {
                v: `${section.category === "OP_ASSETS" ? "OPENING ASSETS" : section.category.toUpperCase()} (${categoryDisplay})`,
                s: {
                    font: { bold: true, sz: 10 },
                    alignment: { horizontal: "center" },
                },
            }

            const dataRows = section.rows.map((row) =>
                columnsData.map((col) => {
                    const value = row[col.accessorKey as keyof typeof row]
                    if (col.cell && typeof col.cell === "function") {
                        if (col.accessorKey === "scrip_name1") {
                            return row["scrip_name1"] || "";
                          }

                        const cellContent = col.cell({ row })
                        if (React.isValidElement(cellContent)) {
                            const elementProps = cellContent.props as any
                            if (col.accessorKey === "Closing_Price") {
                                const formatted = elementProps.children[0].props.children
                                const priceDate = elementProps.children[1].props.children
                                return {
                                    v: `${formatted} ${" "}${priceDate}`,
                                    s: { alignment: { wrapText: false } },
                                }
                            }
                            return elementProps.children
                        }
                        return cellContent
                    }
                    if (typeof value === "number") {
                        if (col.accessorKey === "PL_AMT") {
                            return formatCurrencyWithColor(value)
                        }
                        const formattedValue = formatCurrency(value)
                        if (col.profitLoss) {
                            return {
                                v: formattedValue,
                                s: {
                                    font: { color: { rgb: value >= 0 ? "008000" : "FF0000" } },
                                },
                            }
                        }
                        return formattedValue
                    }
                    return value || ""
                }),
            )

            return [[], centeredCategoryRow, ...dataRows]
        })

        const worksheet = XLSX.utils.aoa_to_sheet(headerData.map((row) => (Array.isArray(row) ? row : row.data || [])))

        const rowsToStyle = [2, 4]
        rowsToStyle.forEach((rowIdx) => {
            const cellRef = `A${rowIdx + 1}`
            if (worksheet[cellRef]) {
                worksheet[cellRef].s = {
                    font: { bold: true, sz: 12 },
                    alignment: { horizontal: "center" },
                }
            }
        })

        // Apply styles and merges
        const merges: XLSX.Range[] = []
        headerData.forEach((row, rowIndex) => {
            if ("isMerged" in row && row.isMerged) {
                // Apply merged cell style
                const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: 0 })
                if (worksheet[cellRef]) {
                    worksheet[cellRef].s = {
                        font: { bold: true, sz: 12 },
                        alignment: { horizontal: "center" },
                    }
                }
                // Add merge
                merges.push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: totalColumns - 1 } })
            } else if ("isSpecial" in row && row.isSpecial) {
                // Apply special style to "Summary", "Total Data Summary", "Expenses", and "Detailed Report"
                const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: 0 })
                if (worksheet[cellRef]) {
                    worksheet[cellRef].s = {
                        font: { bold: true, sz: 12 },
                        alignment: { horizontal: "left" },
                    }
                }
            }
        })

        // Apply styles
        worksheet["A1"].s = {
            font: { bold: true, sz: 16 },
            alignment: { horizontal: "center" },
        }

        worksheet["!merges"] = merges

        // Apply freeze to ensure header stays visible
        worksheet["!freeze"] = { xSplit: 0, ySplit: headerData.length }

        const processedRows = rows.map((row) => (Array.isArray(row) ? row : [row]))

        XLSX.utils.sheet_add_aoa(worksheet, [columnsData.map((col) => col.header)], { origin: -1 })
        XLSX.utils.sheet_add_aoa(worksheet, processedRows, { origin: -1 })

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
        const filename = `${downloadFileName}_${timestamp}.xlsx`
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1")
        XLSX.writeFile(workbook, filename)
    }

    const handleFilterChange = debounce((event: React.ChangeEvent<HTMLInputElement>) => {
        setFilterValue(event.target.value)
        $(tableRef.current).DataTable().search(event.target.value).draw()
    }, 300)

    const toggleColumnVisibility = (columnId: string) => {
        const dt = $(tableRef.current).DataTable()
        const column = dt.column(`${columnId}:name`)
        const newVisibility = !column.visible()
        column.visible(newVisibility)
        setColumnVisibility((prev) => ({ ...prev, [columnId]: newVisibility }))

        // Force redraw of the table to ensure proper layout
        dt.columns.adjust().draw(false)
    }

    return (
        <div className="w-full">
            <div className="flex items-center py-4 gap-2">
                {/* <div className="hidden md:block w-full max-w-sm">
                    <Input
                        placeholder={filterPlaceholder}
                        value={filterValue}
                        onChange={handleFilterChange}
                        className="max-w-sm"
                    />
                </div>
                <div className="md:hidden">
                    <Popover open={isSearchOpen} onOpenChange={setIsSearchOpen}>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="icon">
                                <Search className="h-4 w-4" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                            <Input placeholder={filterPlaceholder} value={filterValue} onChange={handleFilterChange} />
                        </PopoverContent>
                    </Popover>
                </div> */}

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="ml-auto">
                            <span className="hidden md:inline">View Columns</span>
                            <ChevronDown className="h-4 w-4 md:ml-2" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[200px]">
                        {columns.map((column) => (
                            <DropdownMenuCheckboxItem
                                key={column.accessorKey}
                                className="capitalize"
                                checked={columnVisibility[column.accessorKey as string] !== false}
                                onCheckedChange={() => toggleColumnVisibility(column.accessorKey as string)}
                                disabled={column.disabled}
                            >
                                {column.header}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={downloadCSV}>
                                <ChartLine className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Download CSV</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider> */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" onClick={downloadExcel}>
                            <FileSpreadsheet className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Download Excel</p>
                    </TooltipContent>
                </Tooltip>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={downloadPDF}
                        >
                            <File className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Print</p>
                    </TooltipContent>
                </Tooltip>
            </div>

            <div className="rounded-md border">
                <table ref={tableRef} className="display">
                    <tbody>{/* The category rows will be inserted by DataTables */}</tbody>
                </table>
            </div>
        </div>
    )
}

export default DatatableNet

