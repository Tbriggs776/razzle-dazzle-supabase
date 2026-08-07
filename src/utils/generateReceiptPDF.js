import { jsPDF } from 'jspdf';

/**
 * Generates a deposit receipt PDF for a quote.
 * Returns the jsPDF instance (call .save() or .output() as needed).
 */
export function generateReceiptPDF({ quote, lead, dc, depositAmount, depositPaymentMethod, checkNumber, checkDate, receiptNumber }) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // --- Header ---
  doc.setFillColor(79, 70, 229); // indigo
  doc.rect(0, 0, pageWidth, 42, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('FLOOR DADDY', 14, 18);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('RAZZLE DAZZLE', 14, 26);
  doc.text('Deposit Receipt', 14, 34);

  // Receipt # top right
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Receipt #${receiptNumber || 'R-' + Date.now().toString().slice(-6)}`, pageWidth - 14, 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, pageWidth - 14, 26, { align: 'right' });

  // --- Customer Info ---
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Received From:', 14, 56);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const customerName = lead ? `${lead.first_name} ${lead.last_name}` : 'Customer';
  doc.text(customerName, 14, 64);
  if (lead?.email) doc.text(lead.email, 14, 71);
  if (lead?.phone) doc.text(lead.phone, 14, 78);
  if (lead?.address_line1) {
    const addr = [lead.address_line1, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
    doc.text(addr, 14, 85);
  }

  // --- DC Info (right side) ---
  if (dc) {
    doc.setFont('helvetica', 'bold');
    doc.text('Design Consultant:', pageWidth / 2 + 10, 56);
    doc.setFont('helvetica', 'normal');
    doc.text(`${dc.first_name} ${dc.last_name}`, pageWidth / 2 + 10, 64);
    if (dc.email) doc.text(dc.email, pageWidth / 2 + 10, 71);
    if (dc.phone) doc.text(dc.phone, pageWidth / 2 + 10, 78);
  }

  // --- Divider ---
  doc.setDrawColor(200, 200, 220);
  doc.setLineWidth(0.5);
  doc.line(14, 94, pageWidth - 14, 94);

  // --- Receipt Table ---
  let y = 104;

  // Table header
  doc.setFillColor(243, 244, 246);
  doc.rect(14, y - 7, pageWidth - 28, 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 100);
  doc.text('Description', 18, y);
  doc.text('Amount', pageWidth - 18, y, { align: 'right' });
  y += 10;

  // Row: Deposit
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Deposit — Flooring Installation', 18, y);
  doc.setFont('helvetica', 'bold');
  const amt = depositAmount ? parseFloat(depositAmount) : 0;
  doc.text(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amt), pageWidth - 18, y, { align: 'right' });
  y += 14;

  // Quote amount if available
  if (quote?.quote_amount) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 100);
    doc.setFontSize(10);
    doc.text('Total Project Amount (quoted)', 18, y);
    doc.text(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(quote.quote_amount), pageWidth - 18, y, { align: 'right' });
    y += 10;

    // Balance due
    const balance = quote.quote_amount - amt;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(11);
    doc.text('Remaining Balance Due:', 18, y);
    doc.text(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(balance), pageWidth - 18, y, { align: 'right' });
    y += 4;
  }

  // Total box
  y += 6;
  doc.setFillColor(79, 70, 229);
  doc.roundedRect(14, y, pageWidth - 28, 20, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('DEPOSIT RECEIVED', 22, y + 13);
  doc.text(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amt), pageWidth - 22, y + 13, { align: 'right' });
  y += 30;

  // --- Payment Details ---
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Payment Details', 14, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 80);

  if (depositPaymentMethod) {
    doc.text(`Method: ${depositPaymentMethod}`, 14, y);
    y += 7;
  }
  if (checkNumber && (depositPaymentMethod === 'Check' || depositPaymentMethod === 'Post-Dated Check')) {
    doc.text(`Check Number: ${checkNumber}`, 14, y);
    y += 7;
  }
  if (checkDate && depositPaymentMethod === 'Post-Dated Check') {
    doc.text(`Check Date: ${new Date(checkDate + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 14, y);
    y += 7;
  }
  if (quote?.location_address) {
    doc.text(`Job Site: ${quote.location_address}`, 14, y);
    y += 7;
  }

  // --- Footer ---
  y += 10;
  doc.setDrawColor(200, 200, 220);
  doc.setLineWidth(0.3);
  doc.line(14, y, pageWidth - 14, y);
  y += 8;

  doc.setTextColor(120, 120, 140);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.text('Thank you for choosing Floor Daddy! This receipt is confirmation of your deposit only.', 14, y);
  y += 6;
  doc.text('A signed contract and final invoice will be provided separately.', 14, y);

  return doc;
}