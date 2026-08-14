# Fellowship Management System - UI/UX Design

## 1. Design Principles

- **Mobile-first**: All screens designed for mobile first, then expanded for desktop
- **Accessible**: WCAG 2.1 AA compliance (contrast, keyboard nav, ARIA labels)
- **Role-based navigation**: Menu items filtered by actual permissions
- **Clear feedback**: Success toasts, error messages, loading spinners, empty states
- **Confirmation dialogs**: Destructive actions require explicit confirmation
- **No unauthorized options**: Hide/show menu items based on real permissions

## 2. Color Palette

| Purpose | Color |
|---------|-------|
| Primary | Blue (#2563eb) |
| Secondary | Gray (#6b7280) |
| Success | Green (#10b981) |
| Warning | Amber (#f59e0b) |
| Danger | Red (#ef4444) |
| Background | Neutral grays (#f9fafb, #f3f4f6) |
| Text primary | #1f2937 |
| Text secondary | #6b7280 |

## 3. Layout Structure

```
┌─────────────────────────────────────────────┐
│  Header (logo, user profile, notifications)  │
├─────────────────────────────────────────────┤
│  Sidebar (role-based menu)                   │
│  ┌─────────────────────────────────────────┐│
│  │  Main Content                           ││
│  │                                         ││
│  │  [Page content here]                    ││
│  │                                         ││
│  └─────────────────────────────────────────┘│
├─────────────────────────────────────────────┤
│  Footer (optional, version info)             │
└─────────────────────────────────────────────┘
```

## 4. Dashboard Components

### 4.1 Role-Specific Dashboards

Each role gets a grid of cards/widgets:

**Admin Dashboard Cards:**
- System Overview (stats: users, members, departments, activities)
- Backup Status (last backup time, next scheduled)
- Recycle Bin (items count, aging)
- Quick Links (settings, users, audit)

**Secretary Dashboard Cards:**
- Members Overview (total, active, inactive, graduated)
- Departments Overview (count, members per dept)
- Activities (upcoming, pending approval)
- Reports (pending review, approved, rejected)
- Pending Approvals (count by type)

**Chairperson Dashboard Cards:**
- Pending Approvals (finance, reports, money requests)
- Finance Overview (total contributions, expenses, budget)
- Department Reports (submitted, approved, pending)
- Recent Activity

**Treasurer Dashboard Cards:**
- Contributions (this month, total, by type)
- Expenses (this month, total)
- Budgets (allocated vs spent)
- Pending Approvals (money requests, expense/budget edits)

**Department Leader Dashboard Cards:**
- Member count (own department)
- Activities (own department)
- Reports (own department submissions)
- Department Finance
- Custom department information

**Ordinary Member Dashboard Cards:**
- Upcoming Activities
- Announcements
- Unread Notifications
- Own Profile (membership status, details)
- Attendance Confirmation (if applicable)

### 4.2 Shared UI Components

- **DataTable**: Sortable, paginated, filterable table with row selection
- **StatusBadge**: Color-coded status indicators (active green, inactive gray, graduated blue, etc.)
- **ApprovalWorkflow**: Visual stepper showing current stage, approver, and history
- **NotificationCenter**: Dropdown with unread count, list of recent notifications
- **SearchBar**: Global search with debounced input
- **Modal**: Confirmation, form dialogs
- **Tabs**: For multi-section pages
- **Breadcrumb**: Navigation trail
- **Pagination**: Server-side pagination with page size selector

## 5. Page Structures

### 5.1 Member Pages
- **List**: Filterable table (name, department, status, etc.)
- **Detail**: Card layout with tabs (Profile, Department Membership, History)
- **Edit Form**: Modal or dedicated page (Secretary only)
- **Registration Form**: Modal with validation

### 5.2 Department Pages
- **List**: Grid of department cards with member counts
- **Detail**: Overview tab (info, members), Leaders tab, Custom Fields tab, Finance tab

### 5.3 Activity Pages
- **List**: Calendar view + list view toggle
- **Detail**: Full activity info, attendance list, share link
- **Create/Edit**: Form with audience targeting

### 5.4 Finance Pages
- **Contributions**: Table with filters, form to add
- **Expenses**: Table + approval workflow view
- **Budgets**: Table + allocation vs spending visualization
- **Money Requests**: Table + workflow view

### 5.5 Report Pages
- **List**: Filter by department, status
- **Detail**: Workflow stepper, report content, approval history

### 5.6 IT Content Pages
- **Gallery**: Image grid
- **Documents**: Table with download
- **News/Announcements**: List with preview

## 6. Approval Workflow UI

Visual stepper component showing:
1. Current stage (highlighted)
2. Approver name/role
3. Status (pending, approved, rejected)
4. Comments thread
5. Action buttons (Approve/Reject) when it's user's turn

## 7. Notification Center

- Dropdown from header showing last 10 notifications
- Dedicated `/notifications` page with full list, read/unread filter
- Unread count badge in header

## 8. PWA & Offline

- Install banner (web + mobile)
- Offline page when no connectivity
- Background sync for offline form submissions (queued, sent when online)

## 9. Responsive Breakpoints

- **Mobile**: < 768px (single column, hamburger menu)
- **Tablet**: 768px - 1024px (two column where appropriate)
- **Desktop**: >= 1024px (full layout with sidebar)

## 10. Forms

- All forms include: input validation messages, loading state, success/error feedback
- Complex forms use multi-step wizards where appropriate (e.g., new member registration with optional department assignment)
