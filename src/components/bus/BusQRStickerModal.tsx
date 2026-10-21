"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatIdForDisplay } from "@/lib/utils";
import { Bus, Download, Printer, QrCode } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { useRef } from "react";

interface BusQRStickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  bus: {
    id: string;
    busNumber: string;
    routeName?: string;
    model?: string;
  } | null;
}

export function BusQRStickerModal({ isOpen, onClose, bus }: BusQRStickerModalProps) {
  const qrRef = useRef<HTMLDivElement>(null);

  if (!bus) return null;

  const qrValue = `bus:${bus.id}`;
  const busLabel = formatIdForDisplay(bus.busNumber || bus.id);

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const canvas = qrRef.current?.querySelector("canvas");
    const dataUrl = canvas ? canvas.toDataURL("image/png") : "";

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bus QR Sticker - ${busLabel}</title>
          <style>
            @page { size: auto; margin: 10mm; }
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 90vh;
              margin: 0;
              background: #fff;
            }
            .sticker {
              width: 380px;
              border: 3px solid #0f172a;
              border-radius: 16px;
              padding: 24px;
              text-align: center;
              box-sizing: border-box;
            }
            .header {
              font-size: 14px;
              font-weight: 800;
              letter-spacing: 1.5px;
              color: #475569;
              text-transform: uppercase;
              margin-bottom: 4px;
            }
            .sub {
              font-size: 11px;
              color: #64748b;
              margin-bottom: 16px;
            }
            .bus-box {
              background: #0f172a;
              color: #fff;
              padding: 8px 16px;
              border-radius: 8px;
              font-size: 24px;
              font-weight: 900;
              letter-spacing: 1px;
              margin-bottom: 8px;
            }
            .route {
              font-size: 13px;
              font-weight: 600;
              color: #0f172a;
              margin-bottom: 16px;
            }
            .qr-wrap {
              display: inline-block;
              padding: 12px;
              border: 2px dashed #cbd5e1;
              border-radius: 12px;
              margin-bottom: 16px;
            }
            .qr-wrap img {
              display: block;
              width: 220px;
              height: 220px;
            }
            .instruction {
              font-size: 12px;
              font-weight: 700;
              color: #0f172a;
              margin-bottom: 4px;
            }
            .footer {
              font-size: 10px;
              color: #64748b;
            }
          </style>
        </head>
        <body>
          <div class="sticker">
            <div class="header">Assam down town University</div>
            <div class="sub">Intelligent Transport Management System</div>
            <div class="bus-box">${busLabel}</div>
            <div class="route">${bus.routeName || "University Transport Route"}</div>
            <div class="qr-wrap">
              <img src="${dataUrl}" alt="Bus QR Code" />
            </div>
            <div class="instruction">DRIVER & RELIEF CONDUCOR CHECK-IN</div>
            <div class="footer">Scan with Driver App to start Morning or Evening trip</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownload = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `bus-qr-${bus.id}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto p-3 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 w-fit mb-2">
            <Bus className="h-6 w-6" />
          </div>
          <DialogTitle className="text-xl font-bold">
            Official Bus Dashboard QR Sticker
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Print and paste this sticker inside the vehicle dashboard for instant dynamic driver check-in.
          </DialogDescription>
        </DialogHeader>

        {/* Sticker Preview Box */}
        <div
          ref={qrRef}
          className="my-2 p-5 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 text-center flex flex-col items-center justify-center space-y-3"
        >
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
              Assam down town University
            </p>
            <p className="text-sm font-black text-foreground">
              {busLabel}
            </p>
            {bus.routeName && (
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                {bus.routeName}
              </p>
            )}
          </div>

          <div className="p-3 bg-white rounded-xl shadow-md border border-zinc-200">
            <QRCodeCanvas
              value={qrValue}
              size={200}
              level="H"
              includeMargin={true}
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
              Relief Pool & Driver Check-In
            </p>
            <p className="text-[10px] text-zinc-500 font-mono">
              Payload: {qrValue}
            </p>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleDownload}
            className="flex-1 gap-2"
          >
            <Download className="h-4 w-4" />
            Download PNG
          </Button>
          <Button
            type="button"
            onClick={handlePrint}
            className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Printer className="h-4 w-4" />
            Print Sticker
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
