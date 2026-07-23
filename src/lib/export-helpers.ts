/**
 * Export Helper Functions
 * Convert Firestore data to Excel with accurate formatting
 * 
 * SECURITY: Migrated from 'xlsx' (vulnerable) to 'exceljs' (secure)
 * The xlsx package had unpatched Prototype Pollution and ReDoS vulnerabilities.
 */

import { formatDateDDMMYYYY } from '@/lib/utils/date-utils';

type ExcelWorkbook = import('exceljs').Workbook;
type ExcelJSRuntime = typeof import('exceljs');

async function loadExcelJS() {
  const runtime = await import('exceljs/dist/exceljs.min.js');
  const excelRuntime = runtime as unknown as ExcelJSRuntime & { default?: ExcelJSRuntime };
  return excelRuntime.default || excelRuntime;
}

/**
 * Export data to Excel file (client-side download)
 * Supports both array of objects and array of arrays formats
 */
export async function exportToExcel(data: any[] | any[][], filename: string, sheetName: string = 'Sheet1') {
  try {
    const ExcelJS = await loadExcelJS();

    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ADTU Bus Services';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(sheetName);

    // If data is empty, just add headers
    if (data.length === 0) {
      console.log('No data to export');
      return false;
    }

    // Check if data is array of arrays (2D array) or array of objects
    const isArray2D = Array.isArray(data[0]);

    if (isArray2D) {
      // Handle array of arrays format (used by management pages)
      data.forEach((row, index) => {
        if (Array.isArray(row)) {
          worksheet.addRow(row);
        } else {
          // Convert non-array items to array
          worksheet.addRow([row]);
        }
      });

      // Style header row if it exists (first row with actual headers)
      if (data.length > 2 && typeof data[2][0] === 'string') {
        const headerRowIndex = data.findIndex(row => 
          Array.isArray(row) && 
          row.length > 1 && 
          typeof row[0] === 'string' && 
          !row[0].includes('ALL') && 
          !row[0].includes('-')
        );
        
        if (headerRowIndex > 0) {
          const headerRow = worksheet.getRow(headerRowIndex + 1);
          headerRow.font = { bold: true };
          headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
          };
          headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        }
      }
    } else {
      // Handle array of objects format (original implementation)
      // Get headers from first object
      const headers = Object.keys(data[0]);

      // Add header row with styling
      worksheet.addRow(headers);
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

      // Add data rows
      data.forEach(item => {
        const row = headers.map(header => item[header]);
        worksheet.addRow(row);
      });
    }

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      let maxLength = 0;
      column.eachCell?.({ includeEmpty: true }, cell => {
        const cellValue = cell.value?.toString() || '';
        maxLength = Math.max(maxLength, cellValue.length);
      });
      column.width = Math.min(Math.max(maxLength + 2, 10), 50);
    });

    // Generate and download file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`✅ Exported ${data.length} rows to ${filename}.xlsx`);
    return true;
  } catch (error) {
    console.error('❌ Error exporting to Excel:', error);
    return false;
  }
}

/**
 * Format student data for export
 */
export function formatStudentsForExport(students: any[], buses: any[] = []): any[] {
  return students.map(student => {
    // Find assigned bus
    const assignedBus = buses.find(b =>
      b.id === student.busId || b.busId === student.busId || b.id === student.busId || b.busId === student.busId
    );

    const busInfo = assignedBus
      ? `Bus-${assignedBus.displayIndex || extractNumber(assignedBus.busId || assignedBus.id)} - ${assignedBus.busNumber || assignedBus.licensePlate || assignedBus.plateNumber || 'Unknown'}`
      : (student.busId || student.busId) ? 'Assigned (Details Not Found)' : 'Not Assigned';

    return {
      'Name': student.fullName || student.name || 'N/A',
      'Email': student.email || 'N/A',
      'Phone': student.phoneNumber || student.phone || student.altPhone || 'N/A',
      'Alternate Phone': student.alternatePhone || student.altPhone || 'N/A',
      'Enrollment ID': student.enrollmentId || 'N/A',
      'Gender': student.gender || 'N/A',
      'Date of Birth': student.dob ? new Date(student.dob).toLocaleDateString() : 'N/A',
      'Faculty': student.faculty || 'N/A',
      'Department': student.department || 'N/A',
      'Parent Name': student.parentName || 'N/A',
      'Parent Phone': student.parentPhone || 'N/A',
      'Address': student.address || 'N/A',
      'Blood Group': student.bloodGroup || 'N/A',
      'Session Duration': student.durationYears ? `${student.durationYears} year(s)` : 'N/A',
      'Session Start': student.sessionStartYear || 'N/A',
      'Session End': student.sessionEndYear || 'N/A',
      'Valid Until': student.validUntil ? new Date(student.validUntil).toLocaleDateString() : 'N/A',
      'Shift': student.shift ? String(student.shift).charAt(0).toUpperCase() + String(student.shift).slice(1) : 'N/A',
      'Route ID': student.routeId || student.routeId || 'N/A',
      'Pickup Point': student.pickupPoint || 'N/A',
      'Assigned Bus': busInfo,
      'Approved By': student.approvedBy || 'N/A',
      'Status': student.status || 'Active',
      'Created At': student.createdAt ? new Date(student.createdAt).toLocaleDateString() : 'N/A'
    };
  });
}

/**
 * Format driver data for export
 */
export function formatDriversForExport(drivers: any[], buses: any[] = []): any[] {
  return drivers.map(driver => {
    const assignedBus = buses.find(b =>
      b.id === driver.busId || b.busId === driver.busId || b.id === driver.busId || b.busId === driver.busId
    );

    const busInfo = assignedBus
      ? `Bus-${assignedBus.displayIndex || extractNumber(assignedBus.busId || assignedBus.id)} - ${assignedBus.busNumber || assignedBus.licensePlate || assignedBus.plateNumber || 'Unknown'}`
      : (driver.busId || driver.busId) ? 'Assigned (Details Not Found)' : 'Not Assigned';

    return {
      'Name': driver.fullName || driver.name || 'N/A',
      'Email': driver.email || 'N/A',
      'Phone': driver.phoneNumber || driver.phone || 'N/A',
      'Alternate Phone': driver.alternatePhone || driver.altPhone || 'N/A',
      'Driver ID': driver.driverId || driver.employeeId || driver.empId || 'N/A',
      'AADHAR Number': driver.aadharNumber || 'N/A',
      'License Number': driver.licenseNumber || 'N/A',
      'Route ID': driver.routeId || driver.routeId || 'N/A',
      'Assigned Bus': busInfo,
      'Shift': driver.shift ? String(driver.shift).charAt(0).toUpperCase() + String(driver.shift).slice(1) : 'N/A',
      'Approved By': driver.approvedBy || 'N/A',
      'Date of Birth': driver.dob ? new Date(driver.dob).toLocaleDateString() : 'N/A',
      'Joining Date': driver.joiningDate ? new Date(driver.joiningDate).toLocaleDateString() : 'N/A',
      'Address': driver.address || 'N/A',
      'Status': driver.status || 'Active',
      'Created At': driver.createdAt ? new Date(driver.createdAt).toLocaleDateString() : 'N/A'
    };
  });
}

/**
 * Format moderator data for export
 */
export function formatModeratorsForExport(moderators: any[]): any[] {
  return moderators.map(mod => ({
    'Name': mod.fullName || mod.name || 'N/A',
    'Email': mod.email || 'N/A',
    'Phone': mod.phoneNumber || mod.phone || 'N/A',
    'Staff ID': mod.staffId || mod.employeeId || mod.empId || 'N/A',
    'Assigned Office': mod.assignedOffice || 'N/A',
    'Status': mod.active ? 'Active' : 'Inactive',
    'Joining Date': mod.joiningDate || mod.createdAt ? new Date(mod.joiningDate || mod.createdAt).toLocaleDateString() : 'N/A'
  }));
}

/**
 * Format bus data for export
 */
export function formatBusesForExport(buses: any[], routes: any[] = []): any[] {
  return buses.map(bus => {
    // Find assigned route
    const assignedRoute = routes.find(r =>
      r.id === bus.routeId || r.routeId === bus.routeId
    );

    const routeNumber = assignedRoute?.routeNumber || assignedRoute?.routeName || 'Not Assigned';
    const stops = assignedRoute?.stops
      ? Array.isArray(assignedRoute.stops)
        ? assignedRoute.stops.map((s: any) => s.stop_name || s.name || s).join(', ')
        : assignedRoute.stops
      : 'N/A';

    return {
      'Bus Number': `Bus-${bus.displayIndex || extractNumber(bus.busId || bus.id)} (bus.busNumber)`,
      'License Plate': bus.licensePlate || bus.plateNumber || bus.busNumber || 'N/A',
      'Route Number': routeNumber,
      'Stops': stops,
      'Capacity': bus.capacity || 'N/A',
      'Driver': bus.driverName || 'Not Assigned',
      'Status': bus.status || 'N/A',
      'Model': bus.model || 'N/A',
      'Year': bus.year || 'N/A',
      'Last Maintenance': bus.lastMaintenance ? new Date(bus.lastMaintenance).toLocaleDateString() : 'N/A'
    };
  });
}

/**
 * Format route data for export
 */
export function formatRoutesForExport(routes: any[]): any[] {
  return routes.map(route => {
    const stops = route.stops
      ? Array.isArray(route.stops)
        ? route.stops.map((s: any) => s.stop_name || s.name || s).join(', ')
        : route.stops
      : 'N/A';

    return {
      'Route Number': route.routeNumber || route.routeName || route.name || 'N/A',
      'Stops': stops,
      'Total Stops': route.totalStops || (Array.isArray(route.stops) ? route.stops.length : 0),
      'Distance (km)': route.distance || 'N/A',
      'Duration (min)': route.estimatedDuration || 'N/A',
      'Status': route.status || 'Active',
      'Created': route.createdAt ? new Date(route.createdAt).toLocaleDateString() : 'N/A'
    };
  });
}

/**
 * Format notification data for export
 */
export function formatNotificationsForExport(notifications: any[], users: any[] = []): any[] {
  return notifications.map(notif => {
    // Try to find the creator/author
    const author = users.find(u => u.id === notif.createdBy || u.uid === notif.createdBy);

    return {
      'Message': notif.body || notif.message || 'N/A',
      'Title': notif.title || 'N/A',
      'Type': notif.type || 'N/A',
      'Author': author?.fullName || author?.name || 'System',
      'Author EMP ID': author?.empId || author?.employeeId || 'N/A',
      'Timestamp': notif.createdAt ? new Date(notif.createdAt).toLocaleString() : 'N/A',
      'Expires At': notif.expiresAt ? new Date(notif.expiresAt).toLocaleString() : 'N/A',
      'Read': notif.read ? 'Yes' : 'No'
    };
  });
}

/**
 * Format applications data for export
 */
export function formatApplicationsForExport(applications: any[]): any[] {
  return applications.map(app => ({
    'Applicant Name': app.applicantName || app.name || 'N/A',
    'Email': app.email || 'N/A',
    'Phone': app.phone || 'N/A',
    'Enrollment ID': app.enrollmentId || 'N/A',
    'Faculty': app.faculty || 'N/A',
    'Department': app.department || 'N/A',
    'Status': app.status ? String(app.status).charAt(0).toUpperCase() + String(app.status).slice(1) : 'N/A',
    'Applied At': app.appliedAt || app.createdAt ? new Date(app.appliedAt || app.createdAt).toLocaleDateString() : 'N/A',
    'Processed At': app.processedAt ? new Date(app.processedAt).toLocaleDateString() : 'N/A',
    'Processed By': app.processedBy || 'N/A',
    'Remarks': app.remarks || app.rejectionReason || 'N/A'
  }));
}

/**
 * Export all data (for dashboard global export)
 */
export async function exportAllData(
  students: any[],
  drivers: any[],
  moderators: any[],
  buses: any[],
  routes: any[],
  notifications: any[],
  applications: any[] = []
) {
  try {
    const ExcelJS = await loadExcelJS();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ADTU Bus Services';
    workbook.created = new Date();

    // Students sheet
    const studentsData = formatStudentsForExport(students, buses);
    addDataToWorksheet(workbook, 'Students', studentsData);

    // Drivers sheet
    const driversData = formatDriversForExport(drivers, buses);
    addDataToWorksheet(workbook, 'Drivers', driversData);

    // Moderators sheet
    const moderatorsData = formatModeratorsForExport(moderators);
    addDataToWorksheet(workbook, 'Moderators', moderatorsData);

    // Buses sheet
    const busesData = formatBusesForExport(buses, routes);
    addDataToWorksheet(workbook, 'Buses', busesData);

    // Routes sheet
    const routesData = formatRoutesForExport(routes);
    addDataToWorksheet(workbook, 'Routes', routesData);

    // Applications sheet
    if (applications && applications.length > 0) {
      const applicationsData = formatApplicationsForExport(applications);
      addDataToWorksheet(workbook, 'Applications', applicationsData);
    }

    // Notifications sheet
    const notifsData = formatNotificationsForExport(notifications, [...students, ...drivers, ...moderators]);
    addDataToWorksheet(workbook, 'Notifications', notifsData);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `Bus_System_Complete_Export_${timestamp}`;

    // Generate and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`✅ Exported all data to ${filename}.xlsx`);
    return true;
  } catch (error) {
    console.error('❌ Error exporting all data:', error);
    return false;
  }
}

/**
 * Helper function to add data to a worksheet with styling
 */
function addDataToWorksheet(workbook: ExcelWorkbook, sheetName: string, data: any[]) {
  const worksheet = workbook.addWorksheet(sheetName);

  if (data.length === 0) {
    worksheet.addRow(['No data']);
    return;
  }

  // Get headers from first object
  const headers = Object.keys(data[0]);

  // Add header row with styling
  worksheet.addRow(headers);
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };

  // Add data rows
  data.forEach(item => {
    const row = headers.map(header => item[header]);
    worksheet.addRow(row);
  });

  // Auto-fit columns
  worksheet.columns.forEach(column => {
    let maxLength = 0;
    column.eachCell?.({ includeEmpty: true }, cell => {
      const cellValue = cell.value?.toString() || '';
      maxLength = Math.max(maxLength, cellValue.length);
    });
    column.width = Math.min(Math.max(maxLength + 2, 10), 50);
  });
}

/**
 * Generate comprehensive bus services report in single sheet format
 */
export async function generateBusServicesReport(
  students: any[], drivers: any[], moderators: any[], buses: any[], routes: any[], notifications: unknown) {
  try {
    const ExcelJS = await loadExcelJS();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ADTU Bus Services';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('ADTU Bus Report');

    // Generate report data with proper formatting
    const reportData = await generateReportData(students, drivers, moderators, buses, routes);

    // Add rows from report data
    reportData.forEach(row => {
      worksheet.addRow(row);
    });

    // Set column widths for better readability
    worksheet.columns = [
      { width: 8 },   // Sl No
      { width: 22 },  // Name columns
      { width: 28 },  // Email columns
      { width: 15 },  // Phone columns
      { width: 22 },  // Faculty/Department columns
      { width: 18 },  // ID columns
      { width: 22 },  // Assignment columns
      { width: 12 },  // Shift columns
      { width: 14 },  // Date columns
      { width: 14 },  // Status columns
    ];

    // Generate filename with current date
    const currentDate = new Date();
    const dateStr = currentDate.toISOString().split('T')[0];
    const filename = `ADTU_Bus_Report_${dateStr}`;

    // Generate and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`✅ Generated comprehensive bus services report: ${filename}.xlsx`);
    return true;
  } catch (error) {
    console.error('❌ Error generating bus services report:', error);
    return false;
  }
}

/**
 * Generate report data in array of arrays format for Excel
 */
async function generateReportData(
  students: any[],
  drivers: any[],
  moderators: any[],
  buses: any[],
  routes: any[]
) {
  const data: any[][] = [];
  const currentDate = new Date();

  // Header Section
  data.push(['Assam down town University']);
  data.push([`Bus Services Report – ${formatDate(currentDate)}`]);
  data.push(['-------------------------------------------------------------']);
  data.push([]); // Blank row
  data.push([]);

  // STUDENTS Section
  data.push(['ALL STUDENTS']);
  data.push([]);

  // Student headers
  const studentHeaders = [
    'Sl No',
    'Name',
    'Email',
    'Phone',
    'Faculty',
    'Enrollment ID',
    'Bus Assigned',
    'Shift',
    'Session Start',
    'Session End',
    'Years Availed',
    'Status'
  ];
  data.push(studentHeaders);

  // Student data
  if (students.length > 0) {
    const sortedStudents = [...students].sort((a, b) => {
      const nameA = (a.fullName || a.name || '').toLowerCase();
      const nameB = (b.fullName || b.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    sortedStudents.forEach((student, index) => {
      const assignedBus = buses.find(b =>
        b.id === student.busId || b.busId === student.busId ||
        b.id === student.busId || b.busId === student.busId
      );

      const status = student.status || 'N/A';
      const yearsAvailed = student.durationYears ? `${student.durationYears} year${student.durationYears > 1 ? 's' : ''}` : 'N/A';

      data.push([
        (index + 1).toString(),
        student.fullName || student.name || 'N/A',
        student.email || 'N/A',
        student.phoneNumber || student.phone || 'N/A',
        student.faculty || 'N/A',
        student.enrollmentId || 'N/A',
        assignedBus ? `Bus-${extractNumber(assignedBus.busId || assignedBus.id)}` : 'Not Assigned',
        student.shift ? student.shift.charAt(0).toUpperCase() + student.shift.slice(1) : 'N/A',
        student.sessionStartYear || 'N/A',
        student.sessionEndYear || 'N/A',
        yearsAvailed,
        status
      ]);
    });
  } else {
    data.push(['No student records found']);
  }

  data.push([]);
  data.push([]);

  // DRIVERS Section
  data.push(['ALL DRIVERS']);
  data.push([]);

  const driverHeaders = [
    'Sl No',
    'Name',
    'Email',
    'Phone',
    'Staff ID',
    'Bus Assigned',
    'Joining Date',
    'Status'
  ];
  data.push(driverHeaders);

  if (drivers.length > 0) {
    drivers.forEach((driver, index) => {
      const assignedBus = buses.find(b =>
        b.id === driver.busId || b.busId === driver.busId ||
        b.id === driver.busId || b.busId === driver.busId ||
        b.activeDriverId === driver.id || b.assignedDriverId === driver.id
      );

      const busAssignment = assignedBus ? `Bus-${extractNumber(assignedBus.busId || assignedBus.id)}` : 'Reserved';
      const status = assignedBus ? 'Active' : 'Reserved';

      data.push([
        (index + 1).toString(),
        driver.fullName || driver.name || 'N/A',
        driver.email || 'N/A',
        driver.phoneNumber || driver.phone || 'N/A',
        driver.driverId || driver.employeeId || driver.empId || 'N/A',
        busAssignment,
        driver.joiningDate ? formatDate(driver.joiningDate) : 'N/A',
        status
      ]);
    });
  } else {
    data.push(['No driver records found']);
  }

  data.push([]);
  data.push([]);

  // MODERATORS Section
  data.push(['ALL MODERATORS']);
  data.push([]);

  const moderatorHeaders = [
    'Sl No',
    'Name',
    'Email',
    'Phone',
    'Staff ID',
    'Assigned Faculty',
    'Joining Date'
  ];
  data.push(moderatorHeaders);

  if (moderators.length > 0) {
    const sortedModerators = [...moderators].sort((a, b) => {
      const nameA = (a.fullName || a.name || '').toLowerCase();
      const nameB = (b.fullName || b.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    sortedModerators.forEach((moderator, index) => {
      data.push([
        (index + 1).toString(),
        moderator.fullName || moderator.name || 'N/A',
        moderator.email || 'N/A',
        moderator.phoneNumber || moderator.phone || 'N/A',
        moderator.staffId || moderator.employeeId || moderator.empId || 'N/A',
        moderator.assignedFaculty || moderator.assignedOffice || 'N/A',
        moderator.joiningDate || moderator.createdAt ? formatDate(moderator.joiningDate || moderator.createdAt) : 'N/A'
      ]);
    });
  } else {
    data.push(['No moderator records found']);
  }

  data.push([]);
  data.push([]);

  // BUSES Section
  data.push(['ALL BUSES']);
  data.push([]);

  const busHeaders = [
    'Sl No',
    'Bus Number',
    'Route Number',
    'All Stops',
    'Driver Assigned',
    'Shift',
    'Total Students'
  ];
  data.push(busHeaders);

  if (buses.length > 0) {
    const sortedBuses = [...buses].sort((a, b) => {
      const numA = extractNumber(a.busId || a.id || '');
      const numB = extractNumber(b.busId || b.id || '');
      return parseInt(numA) - parseInt(numB);
    });

    sortedBuses.forEach((bus, index) => {
      let routeInfo = bus.route;
      if (!routeInfo) {
        routeInfo = routes.find(r =>
          r.id === bus.routeId ||
          r.routeId === bus.routeId
        );
      }

      const routeName = routeInfo?.routeName || routeInfo?.route || 'Not Assigned';

      let stops = 'N/A';
      if (routeInfo && routeInfo.stops) {
        if (Array.isArray(routeInfo.stops)) {
          stops = routeInfo.stops.map((s: any) => s.stop_name || s.name || s).join(', ');
        } else if (typeof routeInfo.stops === 'string') {
          stops = routeInfo.stops;
        }
      }

      const driverIdToFind = bus.activeDriverId || bus.assignedDriverId;
      const assignedDriver = driverIdToFind ? drivers.find(d => d.id === driverIdToFind) : null;

      const totalStudents = students.filter(s =>
        s.busId === bus.id ||
        s.busId === bus.busId ||
        s.busId === bus.id ||
        s.busId === bus.busId ||
        s.currentBusId === bus.id ||
        s.currentBusId === bus.busId
      ).length;

      data.push([
        (index + 1).toString(),
        `Bus-${extractNumber(bus.busId || bus.id)}`,
        routeName,
        stops,
        assignedDriver ? (assignedDriver.fullName || assignedDriver.name || 'Unknown Driver') : 'Not Assigned',
        bus.shift ? bus.shift.charAt(0).toUpperCase() + bus.shift.slice(1) : 'N/A',
        totalStudents.toString()
      ]);
    });
  } else {
    data.push(['No bus records found']);
  }

  data.push([]);
  data.push([]);

  return data;
}

/**
 * Format date as DD-MM-YYYY
 */
const formatDate = formatDateDDMMYYYY;

/**
 * Helper to extract number from string
 */
function extractNumber(str: string): string {
  if (!str) return '?';
  const match = str.match(/\d+/);
  return match ? match[0] : '?';
}
