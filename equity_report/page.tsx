/* eslint-disable react-hooks/exhaustive-deps */
"use client"

import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { ExternalLink, Info, Loader, Search } from "lucide-react"
import { format } from "date-fns"
import { useForm } from "react-hook-form"

import * as z from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
// import { DataTable } from "@/components/DataTable"
// import { DataTableAnnual } from "@/components/DataTableAnnual"
import { columns, hiddenColumns, liabilitiesColumn } from "@/components/Dashboard/AnnualPL/columns"
import DashboardLayout from "@/components/Dashboard/dashboard-layout"
import DataTableSkeleton from "@/components/DataTable-Skeleton"
import DecryptedText from "@/components/ui/DecryptedText"

import { annualPL } from "@/api/auth"

import { toast } from "sonner"
import { SessionExpiredModal, validateToken } from "@/utils/tokenValidation"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import ExpensesDisplay from "@/components/Dashboard/ReusableComponents/ExpensesDisplays"
import TotalDataSummary from "@/components/Dashboard/ReusableComponents/TotalDataSummary"
import { AddPortfolioDialog } from "@/components/Dashboard/ReusableComponents/AddPortfolioDialog"
import { DataTable } from "@/components/DataTable"
// import DatatableNet from "@/components/DataTableNet"

import dynamic from "next/dynamic";

const DatatableNet = dynamic(() => import("@/components/DataTableNet"), { ssr: false, loading: () => <DataTableSkeleton columns={4} rows={10} /> });

const LazyDataTable = lazy(() => import("@/components/DataTable").then((module) => ({ default: module.DataTable })))

interface RowData {
    tradeDate: string;
    scripName: string;
    scrip: string;
    isin: string;
    buySell: string;
    narration: string;
    quantity: number;
    rate: string;
}

export default function AnnualPLPage() {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [data, setData] = useState<[]>([])
    const [showSessionExpired, setShowSessionExpired] = useState(false)
    const [expensesData, setExpensesData] = useState([])
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [selectedRow, setSelectedRow] = useState<RowData | null>(null)

    /// Helper to generate financial years
    const getFinancialYears = () => {
        const today = new Date()
        const currentMonth = today.getMonth()
        const currentYear = today.getFullYear()
        const startYear = currentMonth < 3 ? currentYear - 1 : currentYear

        return Array.from({ length: 5 }, (_, index) => {
            const year = startYear - index
            return {
                label: `${year}-${year + 1}`,
                value: `${year}-${year + 1}`,
                fromDate: format(new Date(year, 3, 1), "dd/MM/yyyy"),
                toDate: format(new Date(year + 1, 2, 31), "dd/MM/yyyy"),
            }
        })
    }
    const financialYears = getFinancialYears()

    // Validation Schema
    const formSchema = z.object({
        financialYear: z.object({
            fromDate: z.string(),
            toDate: z.string(),
            value: z.string(),
        }),
        toDate: z.string().nonempty("To Date is required"),
    })

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            financialYear: financialYears[0],
            toDate: financialYears[0].toDate,
        },
    })

    const { watch, setValue } = form

    // Watch for financialYear changes
    useEffect(() => {
        const subscription = watch((value, { name }) => {
            if (name === "financialYear") {
                setValue("toDate", value.financialYear?.toDate || financialYears[0].toDate)
            }
        })
        return () => subscription.unsubscribe()
    }, [watch, financialYears, setValue])

    // Fetch Annual PL Data
    const fetchAnnualPLData = async (fromDate: string, toDate: string) => {
        setLoading(true)
        try {
            const response = await annualPL({ fromDate, toDate })
            const tokenIsValid = validateToken(response)

            if (!tokenIsValid) {
                setShowSessionExpired(true)
                return
            }

            const parsedData = typeof response.data.data === "string" ? JSON.parse(response.data.data) : response.data.data
            if (parsedData.Success === "True") {
                toast.success("Data fetched successfully!")
                const description = parsedData["Success Description"]
                const expensesRows = description.filter((row: { TR_TYPE: string }) => row.TR_TYPE === "Expenses")
                const nonExpensesRows = description.filter((row: { TR_TYPE: string }) => row.TR_TYPE !== "Expenses")
                setExpensesData(expensesRows)
                setData(nonExpensesRows)
            } else {
                throw new Error(parsedData["Error Description"] || "Failed to fetch data.")
            }
        } catch (error: any) {
            setError(error.message || "An error occurred.")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        const { fromDate, toDate } = financialYears[0]
        fetchAnnualPLData(fromDate, toDate)
    }, [])

    const onSubmit = (formData: z.infer<typeof formSchema>) => {
        const { financialYear, toDate } = formData
        fetchAnnualPLData(financialYear.fromDate, toDate)
    }

    // Normalize TR_TYPE values
    const normalizedData = data.map((row: any) => ({
        ...row,
        TR_TYPE: ["LONGTERM", "OP LONGTERM"].includes(row.TR_TYPE)
            ? "LONGTERM"
            : ["SHORTTERM", "OP_SHORTTERM"].includes(row.TR_TYPE)
                ? "SHORTTERM"
                : row.TR_TYPE,
    }))

    // Group data by TR_TYPE
    const groupedData = normalizedData.reduce((acc: Record<string, { rows: any[]; sum: number }>, row: any) => {
        const key = row.TR_TYPE
        if (!acc[key]) acc[key] = { rows: [], sum: 0 }
        acc[key].rows.push(row)
        if (key === "LIABILITIES") {
            acc[key].sum += Number.parseFloat(row.SALE_AMT?.toString() || "0")
        } else {
            acc[key].sum += Number.parseFloat(row.PL_AMT?.toString() || "0")
        }
        return acc
    }, {})

    // Ensure `OP_ASSETS` is always first and `ASSETS` is always second
    const sortedGroupedData = Object.entries(groupedData)
        .sort(([keyA], [keyB]) => {
            if (keyA === "OP_ASSETS") return -1 // `OP_ASSETS` is always first
            if (keyB === "OP_ASSETS") return 1 // Push other keys below `OP_ASSETS`
            if (keyA === "ASSETS") return -1 // `ASSETS` is second
            if (keyB === "ASSETS") return 1 // Push other keys below `ASSETS`
            return 0 // Keep the rest in their original order
        })
        .reduce(
            (acc, [key, value]) => {
                acc[key] = value
                return acc
            },
            {} as Record<string, { rows: any[]; sum: number }>,
        )

    const totalexpenses = expensesData?.reduce(
        (total: number, expense: any) => total + Number.parseFloat(expense.PL_AMT?.toString() || "0"),
        0,
    )

    const cleanSymbol = (symbol: string) => symbol.replace(/^\*|\*$/g, "")

    const processedExpensesData = (() => {
        const mergedData: Record<string, { BUY_COMPANY_CODE: string; PL_AMT: number }> = {}

        // Merge CGST and SGST into GST and calculate totals
        expensesData.forEach((expense: any) => {
            const { BUY_COMPANY_CODE, PL_AMT } = expense
            const cleanedName = cleanSymbol(BUY_COMPANY_CODE) // Apply cleanSymbol to BUY_COMPANY_CODE
            const key = cleanedName === "CGST" || cleanedName === "SGST" ? "GST" : cleanedName

            if (!mergedData[key]) {
                mergedData[key] = { BUY_COMPANY_CODE: key, PL_AMT: 0 }
            }
            mergedData[key].PL_AMT += Number(PL_AMT)
        })

        // Convert the merged data back into an array
        const mergedArray = Object.values(mergedData)

        // Sort the array by the desired order: STT, STAMP DUTY, GST, followed by others
        const order = ["STT", "STAMP DUTY", "GST"]
        return mergedArray.sort((a, b) => {
            const indexA = order.indexOf(a.BUY_COMPANY_CODE)
            const indexB = order.indexOf(b.BUY_COMPANY_CODE)
            if (indexA !== -1 && indexB !== -1) return indexA - indexB // Both are in the predefined order
            if (indexA !== -1) return -1 // A is in the predefined order
            if (indexB !== -1) return 1 // B is in the predefined order
            return 0 // Keep the original order for others
        })
    })()

    const handleTypeClick = (type: string) => {
        const element = document.getElementById(type)
        if (element) {
            element.scrollIntoView({ behavior: "smooth" })
        }
    }

    const handleAddPortfolio = useCallback((rowData: any) => {
        if (rowData?.scrip_name) {
            const scripNameParts = rowData.scrip_name.split("-");
            const isinValue = scripNameParts[0].trim();

            setSelectedRow({
                tradeDate: "",
                scripName: rowData.scrip_name1,
                scrip: rowData.SCRIP_SYMBOL,
                isin: isinValue,
                buySell: "B",
                narration: "",
                quantity: rowData.SALE_QTY,
                rate: "",
            });
            setIsDialogOpen(true);
        }
    }, []);



    // console.log(sortedGroupedData);
    // // Normalize and combine TR_TYPE sum with rows
    // const combinedData = Object.entries(sortedGroupedData).map(([type, { rows, sum }]) => ({
    //     type, // TR_TYPE
    //     sum,  // sum for this TR_TYPE
    //     rows: [
    //         {
    //             TR_TYPE: type,
    //             scrip_name1: `${type} - Sum: ${new Intl.NumberFormat("en-IN", {
    //                 style: "currency",
    //                 currency: "INR",
    //             }).format(Math.abs(sum))}`, // Type and sum in the `scrip_name1` column
    //             sum: sum, // Sum for this TR_TYPE
    //             SCRIP_SYMBOL: " ",
    //             BUY_QTY: " ",
    //             BUY_RATE: "",
    //             BUY_AMT: "",
    //             BUY_TRADE_DATE: "",
    //             SALE_QTY: "",
    //             SALE_RATE: "",
    //             SALE_AMT: "",
    //             SALE_TRADE_DATE: "",
    //             NET_QTY: "",
    //             CURR_AMOUNT: "",
    //             PL_AMT: "",
    //             Closing_Price: "",
    //             isSummaryRow: true,
    //             rowId: type, // Assign the `type` as the `id`
    //         },
    //         ...rows, // Actual data rows for this TR_TYPE
    //     ],
    // }));

    return (
        <>
            <DashboardLayout>
                <div className="space-y-4">
                    <Card>
                        <CardHeader className="flex flex-col md:flex-col sm:flex-col  mb-4">
                            <div className="flex-1">
                                <CardTitle>IT Report Equity</CardTitle>
                            </div>
                            <div className="flex-shrink-0 m-0">
                                <Form {...form}>
                                    <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-3">
                                        <FormField
                                            control={form.control}
                                            name="financialYear"
                                            render={({ field }) => {
                                                return (
                                                    <FormItem className="w-[200px]">
                                                        <Select
                                                            onValueChange={(value) => {
                                                                // Find the selected year based on value
                                                                const selectedYear = financialYears.find((fy) => fy.value === value)
                                                                field.onChange(selectedYear) // Pass the selected year object to form
                                                            }}
                                                            defaultValue={field.value?.value || ""} // Use the 'value' property of the object
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select year" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                {financialYears.map((fy) => (
                                                                    <SelectItem key={fy.value} value={fy.value}>
                                                                        {fy.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )
                                            }}
                                        />

                                        <FormField
                                            control={form.control}
                                            name="toDate"
                                            render={({ field }) => (
                                                <FormItem className="w-[150px]">
                                                    <FormControl>
                                                        <Input
                                                            type="date"
                                                            className="flex h-10 w-full rounded-md border text-white bg-transparent px-3 py-2 text-sm "
                                                            value={format(new Date(field.value.split("/").reverse().join("-")), "yyyy-MM-dd")}
                                                            min={format(
                                                                new Date(form.watch("financialYear").fromDate.split("/").reverse().join("-")),
                                                                "yyyy-MM-dd",
                                                            )}
                                                            max={format(
                                                                new Date(form.watch("financialYear").toDate.split("/").reverse().join("-")),
                                                                "yyyy-MM-dd",
                                                            )}
                                                            onChange={(e) => {
                                                                const date = new Date(e.target.value)
                                                                field.onChange(format(date, "dd/MM/yyyy"))
                                                            }}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <Button type="submit" disabled={loading}>
                                            {loading ? <Loader /> : <Search className="h-5 w-5" />}
                                        </Button>
                                    </form>
                                </Form>
                            </div>
                        </CardHeader>

                        <CardContent>
                            {(Object.keys(sortedGroupedData).length > 0 || processedExpensesData.length > 0) && !error && (
                                <TotalDataSummary
                                    sortedGroupedData={sortedGroupedData}
                                    totalExpenses={totalexpenses}
                                    handleTypeClick={handleTypeClick}
                                />
                            )}

                            {loading ? (
                                <DataTableSkeleton columns={4} rows={10} />
                            ) : error ? (
                                <h3 className="text-center text-red-500">{error}</h3>
                            ) : (
                                // Object.entries(sortedGroupedData).map(([type, { rows, sum }]) => (
                                //     <div key={type} id={type} className="mb-8">
                                //         <div className="flex justify-between items-center gap-6">
                                //             <div className="flex gap-1 items-center">
                                //                 <h3 className="text-lg font-semibold">{type === "OP_ASSETS" ? "OPENING ASSETS" : type.toUpperCase()}</h3>
                                //                 <Tooltip>
                                //                     <TooltipTrigger asChild>
                                //                         <div className="cursor-pointer">
                                //                             <Info size={16} />
                                //                         </div>
                                //                     </TooltipTrigger>

                                //                     <TooltipContent className="min-w-[50px] max-w-[250px] p-4 m-2 bg-gray-800 text-white rounded-md shadow-md">
                                //                         <p>
                                //                             {type === "OP_ASSETS"
                                //                                 ? "Holdings acquired before the beginning of the current financial year. These assets have been carried forward from previous periods and are part of the portfolio's opening balance."
                                //                                 : type === "ASSETS"
                                //                                     ? "Holdings purchased during the current financial year. These represent new acquisitions added to the portfolio after the start of the financial year."
                                //                                     : type === "SHORTTERM"
                                //                                         ? "The profit earned from selling assets held for a period of less than 12 months, subject to applicable short-term capital gains tax."
                                //                                         : type === "LONGTERM"
                                //                                             ? "The profit earned from selling assets held for a period of 12 months or more, typically eligible for preferential tax rates"
                                //                                             : type === "LIABILITIES"
                                //                                                 ? "Represents stocks that have been sold but lack corresponding buy trade records in the back-office system. This indicates a discrepancy requiring reconciliation to ensure accurate transaction history and financial reporting."
                                //                                                 : type === "TRADING"
                                //                                                     ? "Represents transactions where stocks are bought and sold on the same trading day. These trades are settled without carrying positions overnight and are typically considered for intraday profit or loss calculations."
                                //                                                     : ""}
                                //                         </p>
                                //                     </TooltipContent>
                                //                 </Tooltip>
                                //             </div>
                                //             <p className={`font-semibold flex flex-wrap gap-2 justify-end `}>
                                //                 {type === "OP_ASSETS" || type === "ASSETS"
                                //                     ? `Unrealized ${sortedGroupedData[type].sum >= 0 ? "Profit" : "Loss"}: `
                                //                     : type === "LIABILITIES"
                                //                         ? `LIABILITIES: `
                                //                         : `${sortedGroupedData[type].sum >= 0 ? "Profit" : "Loss"}: `}
                                //                 <span className={`${sum >= 0 ? "text-green-600" : "text-red-600"}`}>
                                //                     <DecryptedText
                                //                         animateOn="view"
                                //                         revealDirection="center"
                                //                         characters="123456789"
                                //                         text={new Intl.NumberFormat("en-IN", {
                                //                             style: "currency",
                                //                             currency: "INR",
                                //                         }).format(Math.abs(sum))}
                                //                     />
                                //                 </span>
                                //             </p>
                                //         </div>
                                //         <DataTable
                                //             columns={type === "LIABILITIES" ? [...columns, liabilitiesColumn] : columns}
                                //             data={rows.map((row) => ({ ...row, onAddPortfolio: handleAddPortfolio }))}
                                //             hiddenColumns={hiddenColumns}
                                //             filterColumn="scrip_name1"
                                //             filterPlaceholder="Filter Scrip..."
                                //             showAllRows={true}
                                //         />
                                //     </div>   
                                // ))

                                <DatatableNet
                                    columns={columns}
                                    data={sortedGroupedData}
                                    hiddenColumns={hiddenColumns}
                                    filterColumn="scrip_name1"
                                    filterPlaceholder="Filter Scrip..."
                                    showAllRows={true}
                                    year={form.watch("financialYear").value}
                                    fromDate={form.watch("financialYear").fromDate}
                                    toDate={form.watch("toDate")}
                                    totalDataSummary={{
                                        unrealized: Object.entries(sortedGroupedData)
                                            .filter(([type]) => type === "OP_ASSETS" || type === "ASSETS")
                                            .reduce((acc, [, { sum }]) => acc + sum, 0),
                                        realized:
                                            Object.entries(sortedGroupedData)
                                                .filter(([type]) => type !== "OP_ASSETS" && type !== "ASSETS" && type !== "LIABILITIES")
                                                .reduce((acc, [, { sum }]) => acc + sum, 0) - Math.abs(Number(totalexpenses)),
                                        liabilities: sortedGroupedData["LIABILITIES"]?.sum || 0,
                                    }}
                                    expensesData={{
                                        rowKey: "BUY_COMPANY_CODE",
                                        rowAmount: "PL_AMT",
                                        rows: processedExpensesData,
                                        total: totalexpenses,
                                    }}

                                    showPagination={false}
                                    downloadFileName={"IT_REPORT_EQUITY"}
                                    onAddPortfolio={handleAddPortfolio}
                                />
                            )}

                            <ExpensesDisplay processedExpensesData={processedExpensesData} totalExpenses={totalexpenses} expenseRowKey={"BUY_COMPANY_CODE"} expenseRowAmount={"PL_AMT"} />
                        </CardContent>
                    </Card>
                </div>
            </DashboardLayout >

            <AddPortfolioDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} rowData={selectedRow} isFromCardHeader={false} />

            {showSessionExpired && <SessionExpiredModal />}
        </>
    )
}

