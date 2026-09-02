import { jsPDF } from 'jspdf';
import { format } from 'date-fns';

const CHECKLIST_ITEMS = [
  { id: 'est_dates', title: 'Estimated Installation & Completion Dates', text: "Customer acknowledges that flooring installation is a construction project and that all installation dates, start dates, and completion dates, whether stated in this Agreement or communicated verbally or in writing by Floor Daddy, LLC, are estimates only and are not guaranteed. Customer further acknowledges and agrees that unforeseen circumstances, including but not limited to product availability, manufacturer delays, weather, site conditions, change orders, labor availability, or other events beyond Floor Daddy, LLC's reasonable control, may affect the project schedule. Accordingly, Floor Daddy, LLC's inability to meet any estimated installation or completion date shall not constitute a breach of this Agreement and shall not entitle Customer to cancel this Agreement, withhold payment, demand a price reduction, assess penalties, or seek monetary damages. Customer agrees that all payments required under this Agreement remain due in accordance with the payment terms, regardless of any scheduling delays. Floor Daddy, LLC does not guarantee completion of the Work within any estimated timeframe." },
  { id: 'floor_height', title: 'Floor Height & Wall Exposure Acknowledgment', text: "Customer acknowledges that replacing one flooring product with another (including, but not limited to, removing tile, hardwood, or engineered wood and installing luxury vinyl plank (LVP), laminate, or other flooring products) may result in a change in finished floor height. Such height differences are an inherent characteristic of installing products of different thicknesses. Customer further acknowledges that any exposed, unpainted, damaged, or previously concealed wall surfaces, paint lines, drywall, texture, caulking, or other cosmetic conditions revealed due to the change in floor height or the removal/reinstallation of existing baseboards are pre-existing conditions and are not the responsibility of Floor Daddy. Floor Daddy shall have no obligation to repair, patch, texture, caulk, repaint, or otherwise restore exposed wall areas or other cosmetic conditions resulting from the difference in flooring thickness." },
  { id: 'cod', title: 'COD', text: 'Must be available upon arrival for your installation to begin. Installation will not begin without full payment. Floordaddy accepts ONLY, Visa, Mastercard, American Express, Discover, money orders or certified checks. Personal checks are NOT ACCEPTED. In the event we cannot get a hold of you to collect the COD prior to installation. You are consenting for us to run any cards on file, automatically to collect any and all COD\'s and balances, prior to starting the installation.' },
  { id: 'install_date', title: 'Installation Date', text: 'will be confirmed by our installation center prior to your scheduled installation. If we are unable to reach you, and for your installation to occur as scheduled, it is vital that you notify our Customer Service team at 480-764-2412 and reference your contract number. They can be reached from 8 a.m. to 9 p.m. (MST) Monday through Friday and Saturday from 8 a.m. to 5pm (MST).' },
  { id: 'delivery', title: 'Delivery Times', text: 'Installations occur between 8 a.m. and 6 p.m. Your installer will call you on the morning of your installation to provide an estimated window of arrival. Unfortunately, a specific time of arrival cannot be provided.' },
  { id: 'pets', title: 'Pets', text: 'Please provide a safe location away from the installation area(s) during the installation process.' },
  { id: 'requirements', title: 'Installation Requirements & Length', text: 'Area(s) in which installation will occur must have electricity and a temperature maintained between 65-85 degrees for 48 hours prior to ensure proper installation. Each Job is unique, and some require more time than others. Floordaddy\'s goal is to provide you with a professional installation. Every effort will be made to complete your job in a timely manner.' },
  { id: 'breaks', title: 'Breaks/Lunches', text: 'The installer will leave every day for 1-hour min but do not worry, they will be back. They are just going to lunch and/or picking up supplies. If they do not show up past an hour, please call the office for us to check, but they will return!' },
  { id: 'extra_material', title: 'Extra Material', text: 'Additional material is often sent to the job sites to ensure adequate material is available to complete our project. Customers are not charged for the additional materials. Your installer will leave the remains of any opened cartons.' },
  { id: 'completion', title: 'Certificate of Completion', text: 'It is required that one of the homeowners be at the job when it is completed. After the installation is complete, the installers will walk through the installed area(s) with you to ensure the installation meets your expectations. You will be asked to sign our Certificate of Completion at that time. NOTE: For financed purchases, the individual who signed the contract must also sign our Certificate of Completion.' },
  { id: 'appliances', title: 'Appliances & Electronics', text: 'We do not disconnect / reconnect any appliances including gas lines for stoves or plumbing attachments on refrigerators, washers, dryers, stovetops, dishwashers, and waterlines for fridges or ice machines. Installers do not disconnect / reconnect electronics. We are not responsible for Wifi/Cable connections or problems.' },
  { id: 'water', title: 'Water', text: 'We are not responsible for bad or broken water shut off valves. You need to call a plumber.' },
  { id: 'grandfather', title: 'Grandfather Clocks, Slate Pool Tables, Filled Aquariums and Grand or Baby Grand Pianos', text: 'items installers will not move.' },
  { id: 'knick', title: 'Knick-Knacks, Breakables, Small items, Pictures, Clothes, Shoes and Wall Hangings', text: 'should be moved prior to the installers arriving. This includes items located in hallways or other areas that the installers must use to access the installation area(s). Clothes, Shoes should be removed from the lower half of the closet.' },
  { id: 'large', title: 'Large/complex items', text: 'like Waterbeds, Giant Entertainment Centers, Solid Oak beds, dressers, and or furniture need to be taken apart or moved prior. Installers can help with these items but may be tough and we are not responsible for them if something breaks. You release Floordaddy from all liability for these complex items. Otherwise, installers will move everything else.' },
  { id: 'packing', title: 'Packing / Unpacking Boxes', text: 'Unfortunately, our installers will not be responsible for any packing or unpacking of boxes containing small items. Please pack items on bookshelves or in cabinets prior to the installation date.' },
  { id: 'cleaning', title: 'Cleaning of Home', text: 'This is the customer\'s responsibility as this is a construction site that creates dust and debris. Blinds, cabinets, counters, etc. will be covered to the best of our ability, but particles, dust, and debris will get through no matter what. We will clean as well as we can prior to leaving, but we will not be responsible for thorough or deep cleanings due to the nature of a construction site.' },
  { id: 'change_orders', title: 'Change Orders', text: 'Must be signed and paid in full, prior to any work being done or being completed.' },
  { id: 'asbestos', title: 'Asbestos', text: 'If, at or before the time of installation, it is suspected or determined that asbestos is present, Buyer will be required to test for the presence of asbestos, and Floordaddy will STOP installation until the buyer has the asbestos removed by a licensed abatement company. The abatement company must follow all applicable federal and state asbestos regulations and must provide a clean air or clearance sampling certificate.' },
  { id: 'adhesive', title: 'Acknowledgment of Adhesive Use in Carpet Installation', text: 'As part of our standard carpet installation process, adhesives and related bonding materials may be used. All products utilized are considered safe for residential and commercial application and meet or exceed applicable safety standards and regulatory requirements. By initialing below, you acknowledge that you have read and understand this notice, and that you accept responsibility for disclosing any relevant health concerns in advance of installation.' },
  { id: 'nicks', title: 'Nicks / Scratches / Scoring', text: 'Installers will try their best to avoid nicks, scratches and scoring of your baseboards and walls, but since the carpet has to be cut and tucked under the baseboards there are some damages that may not be prevented. Floordaddy will not touch or paint baseboards or walls.' },
  { id: 'seams', title: 'Seams', text: 'are required in areas in which the room is wider and longer than widths in which the product is manufactured. Placing of seams shall be at the discretion of the lead installer unless otherwise specified in writing. Visibility will vary by product and how it reacts to room lighting.' },
  { id: 'doors', title: 'Door Casings/Doors', text: 'When installing vinyl plank, laminate, or tile, and removing existing thicker flooring, you will notice door casings are now short, due to the new product being thinner. Floordaddy is not responsible for short door casings and we will not caulk them.' },
  { id: 'tile', title: 'Tile', text: 'must remain free from foot traffic for 12 hours after initial tile installation and 12 hours after grouting. Manufacture spec to be followed on all materials, including grout joint size, tile spacing and installation.' },
  { id: 'chairs', title: 'Chairs', text: 'damages caused to vinyl or laminate from roller chairs. This will void the warranty/guarantee. Office chairs must have floor mats underneath them and FD is not responsible for the damage that is caused by them.' },
  { id: 'moisture', title: 'Moisture', text: 'While some products may be listed as water-resistant or waterproof, we cannot be held liable for damage to any water exposure. Including but not limited to; dog/cat pee, any and all leaks, floods, or water damage to one board or the whole house. All steam mops, Steam Sharks, or shampooing the carpet on your own or by a professional, etc., will void warranties.' },
  { id: 'laminate', title: 'Laminate Flooring Installations Over 1,000 sq.ft.', text: 'For installations of laminate flooring exceeding 1,000 square feet, it is required and in your best interest that we install T-molding transitions between certain rooms or areas. Laminate flooring naturally expands and contracts with changes in temperature and humidity.' },
  { id: 'care', title: 'How To Care For Your floors', text: 'Laminate, luxury vinyl plank (LVP), or wood floors should not be cleaned by a wet mop, with water, soap, harsh chemicals, Fabuloso, Pledge, Pine Sol, Vinegar (even diluted in water), or products that may contain wax, or oils, as it may permanently damage the flooring.' },
];

export async function generatePreInstallPDF({ customerName, productInfo, signatureUrl, saleDate }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;
  const initials = customerName
    ? customerName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '??';
  const today = saleDate ? format(new Date(saleDate), 'MMM dd, yyyy') : format(new Date(), 'MMM dd, yyyy');

  let y = margin;

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(29, 78, 216); // blue
  doc.text('PRE-INSTALLATION CHECKLIST', pageW / 2, y, { align: 'center' });
  y += 20;

  // Name / Date row
  doc.setFontSize(10);
  doc.setTextColor(50, 50, 50);
  doc.setFont('helvetica', 'normal');
  doc.rect(margin, y, contentW * 0.55, 18);
  doc.text(`Name: ${customerName}`, margin + 5, y + 13);
  doc.rect(margin + contentW * 0.57, y, contentW * 0.43, 18);
  doc.text(`Date: ${today}`, margin + contentW * 0.57 + 5, y + 13);
  y += 28;

  // Product confirmation line
  doc.setFont('helvetica', 'bold');
  doc.text('Product Confirmation: ', margin, y + 4);
  const labelW = doc.getTextWidth('Product Confirmation: ');
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(29, 78, 216);
  doc.text(productInfo || '', margin + labelW, y + 4);
  doc.setTextColor(50, 50, 50);
  y += 18;

  // Checklist items
  for (const item of CHECKLIST_ITEMS) {
    const fullText = `${item.title} - ${item.text}`;
    const lines = doc.splitTextToSize(fullText, contentW - 36);
    const blockH = lines.length * 11 + 6;

    if (y + blockH > pageH - margin - 80) {
      doc.addPage();
      y = margin;
    }

    // Initials badge box
    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(147, 197, 253);
    doc.roundedRect(margin, y, 28, 14, 2, 2, 'FD');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(29, 78, 216);
    doc.text(initials, margin + 14, y + 10, { align: 'center' });

    // Item text
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    const titleEnd = doc.getTextWidth(item.title + ' - ');
    // Render title bold, rest normal
    const titleLines = doc.splitTextToSize(item.title + ' - ' + item.text, contentW - 36);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    titleLines.forEach((line, i) => {
      if (i === 0) {
        doc.setFont('helvetica', 'bold');
        doc.text(item.title + ' - ', margin + 32, y + 11);
        const boldW = doc.getTextWidth(item.title + ' - ');
        doc.setFont('helvetica', 'normal');
        // remaining text on first line
        const firstLineRest = line.slice((item.title + ' - ').length);
        if (firstLineRest) doc.text(firstLineRest, margin + 32 + boldW, y + 11);
      } else {
        doc.text(line, margin + 32, y + 11 + i * 11);
      }
    });

    y += titleLines.length * 11 + 8;
  }

  // Signature section
  if (y + 100 > pageH - margin) {
    doc.addPage();
    y = margin;
  }

  y += 10;
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y, pageW - margin, y);
  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text('By signing below, the customer acknowledges they have read and agree to all items above.', margin, y);
  y += 18;

  // Embed signature image
  if (signatureUrl) {
    try {
      const response = await fetch(signatureUrl);
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      doc.addImage(dataUrl, 'PNG', margin, y, 180, 50);
      y += 56;
    } catch (e) {
      doc.text('[Signature image unavailable]', margin, y + 14);
      y += 20;
    }
  }

  doc.setDrawColor(100, 100, 100);
  doc.line(margin, y, margin + 220, y);
  doc.setFontSize(8);
  doc.text("Buyer's Signature", margin, y + 10);
  doc.line(pageW - margin - 120, y, pageW - margin, y);
  doc.text('Date: ' + today, pageW - margin - 120, y + 10);

  y += 24;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Buyer: ${customerName}`, margin, y);

  doc.save(`pre-install-checklist-${customerName.replace(/\s+/g, '-')}.pdf`);
}