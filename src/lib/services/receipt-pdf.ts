import { jsPDF } from 'jspdf';

export interface ReceiptPdfData {
  receiptId: string;
  studentName: string;
  enrollmentId: string;
  faculty?: string;
  amount: number;
  paymentMethod: string;
  paymentReference?: string;
  approvedBy: string;
  sessionStartYear?: number | string;
  sessionEndYear?: number | string;
  durationYears?: number;
  validUntil?: string | null;
  transactionDate: string;
  qrCodeDataUrl: string;
  previousValidUntil?: string | null;
  previousSessionEndYear?: number | string | null;
  purpose?: string | null;
}

function formatDate(value?: string | null): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';

  const day = date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${day} | ${time}`;
}

function drawWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight = 5
): number {
  const lines = doc.splitTextToSize(text || 'N/A', maxWidth) as string[];
  doc.text(lines, x, y);
  return y + Math.max(lines.length, 1) * lineHeight;
}

function drawInfoBox(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, width, height, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(label.toUpperCase(), x + 5, y + 7);
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  drawWrappedText(doc, value, x + 5, y + 14, width - 10, 4.5);
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const doc = new jsPDF({
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  doc.setProperties({
    title: `Receipt ${data.receiptId}`,
    subject: 'ADTU ITMS transport payment receipt',
    author: 'ADTU Integrated Transit Management System',
    creator: 'ADTU ITMS',
    keywords: `receipt,adtu,itms,${data.receiptId}`,
  });

  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, doc.internal.pageSize.getHeight(), 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text('Assam down town University,', 18, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Sankar Madhab Path, Gandhi Nagar,', 18, 25);
  doc.text('Panikhaiti, Guwahati, Assam, India,', 18, 29);
  doc.text('Pin – 781026', 18, 33);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('TRANSACTION RECEIPT', 128, 22);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  doc.text(data.receiptId, 128, 28, { maxWidth: 62 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(formatDateTime(data.transactionDate), 128, 36);

  if (data.qrCodeDataUrl) {
    doc.addImage(data.qrCodeDataUrl, 'PNG', 159, 43, 32, 32);
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('SCAN TO VERIFY', 163, 79);
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(18, 42, 192, 42);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text('Payment Receipt', 18, 58);

  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(187, 247, 208);
  doc.roundedRect(18, 64, 38, 9, 4, 4, 'FD');
  doc.setFontSize(8);
  doc.setTextColor(22, 101, 52);
  doc.text('VERIFIED PAYMENT', 22, 70);

  drawInfoBox(doc, 'Student', data.studentName, 18, 84, 82, 30);
  drawInfoBox(doc, 'Enrollment ID', data.enrollmentId || 'N/A', 110, 84, 82, 30);
  drawInfoBox(doc, 'Department / Faculty', data.faculty || 'General', 18, 121, 82, 30);
  drawInfoBox(doc, 'Payment Method', `${data.paymentMethod} Payment`, 110, 121, 82, 30);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('SUBSCRIPTION PROGRESSION', 18, 164);
  doc.setDrawColor(226, 232, 240);
  doc.line(70, 162, 192, 162);

  const firstTime = !data.previousValidUntil || data.purpose === 'new_registration';
  drawInfoBox(
    doc,
    'Initial Validity',
    firstTime
      ? 'Not applicable (new admission)'
      : `${formatDate(data.previousValidUntil)}${data.previousSessionEndYear ? `, session ${data.previousSessionEndYear}` : ''}`,
    18,
    171,
    82,
    30
  );
  drawInfoBox(
    doc,
    'Updated Validity',
    `${formatDate(data.validUntil)}${data.sessionEndYear ? `, session ${data.sessionEndYear}` : ''}`,
    110,
    171,
    82,
    30
  );

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(18, 212, 174, 28, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('TOTAL AMOUNT PAID', 26, 223);
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text(`Rs. ${Number(data.amount || 0).toLocaleString('en-IN')}`, 138, 228, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  drawWrappedText(doc, `Approved by: ${data.approvedBy}`, 18, 252, 174, 4.5);
  if (data.paymentReference) {
    drawWrappedText(doc, `Payment reference: ${data.paymentReference}`, 18, 259, 174, 4.5);
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(18, 276, 192, 276);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('This receipt is generated by ADTU ITMS. Verify the QR code against official server records before trusting any copy.', 18, 283, {
    maxWidth: 174,
  });

  const pdf = doc.output('arraybuffer');
  return Buffer.from(pdf);
}
