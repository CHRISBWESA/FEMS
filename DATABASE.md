# Fellowship Management System - Database Design

> **Current-state note (Phase 23):** `backend/prisma/schema.prisma` and `backend/prisma/migrations/` are authoritative. The tables below are the original relational design and omit later Phase 14-23 entities, tenant columns, workflow fields, and constraints. Do not use this document to create or alter a database; follow [DATABASE_MIGRATION_GUIDE.md](DATABASE_MIGRATION_GUIDE.md).

## 1. Database Schema

### 1.1 Core Tables

#### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| email | TEXT | UNIQUE, NOT NULL |
| password_hash | TEXT | NOT NULL |
| first_name | TEXT | NOT NULL |
| last_name | TEXT | NOT NULL |
| phone | TEXT | |
| gender | TEXT | CHECK (gender IN ('male','female','other')) |
| is_active | BOOLEAN | DEFAULT true |
| must_change_password | BOOLEAN | DEFAULT false |
| created_at | TIMESTAMP | DEFAULT NOW() |
| updated_at | TIMESTAMP | DEFAULT NOW() |
| deleted_at | TIMESTAMP | (soft delete) |

#### roles
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| name | TEXT | UNIQUE, NOT NULL |
| description | TEXT | |
| is_system_role | BOOLEAN | DEFAULT false |

#### user_roles
| Column | Type | Constraints |
|--------|------|-------------|
| user_id | UUID (FK) | REFERENCES users(id), ON DELETE CASCADE |
| role_id | UUID (FK) | REFERENCES roles(id), ON DELETE CASCADE |
| assigned_at | TIMESTAMP | DEFAULT NOW() |
| assigned_by | UUID (FK) | REFERENCES users(id) |
| PRIMARY KEY | | (user_id, role_id) |

Roles defined:
- admin
- secretary
- assistant_secretary
- chairperson
- assistant_chairperson
- treasurer
- department_secretary
- department_chairperson
- gender_leader
- ordinary_member

#### permissions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| name | TEXT | UNIQUE, NOT NULL |
| description | TEXT | |

#### role_permissions
| Column | Type | Constraints |
|--------|------|-------------|
| role_id | UUID (FK) | REFERENCES roles(id), ON DELETE CASCADE |
| permission_id | UUID (FK) | REFERENCES permissions(id), ON DELETE CASCADE |
| PRIMARY KEY | | (role_id, permission_id) |

### 1.2 Member Tables

#### members
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| user_id | UUID (FK) | REFERENCES users(id) UNIQUE (link to user account) |
| member_code | TEXT | UNIQUE, NOT NULL |
| full_name | TEXT | NOT NULL |
| phone | TEXT | |
| email | TEXT | |
| gender | TEXT | CHECK |
| programme | TEXT | |
| year_of_study | TEXT | |
| university | TEXT | |
| expected_graduation_year | INTEGER | |
| expected_graduation_month | INTEGER | CHECK (1-12) |
| membership_status | TEXT | CHECK (status IN ('active','inactive','graduated')) |
| status_changed_by | UUID (FK) | REFERENCES users(id) |
| status_changed_at | TIMESTAMP | |
| created_at | TIMESTAMP | DEFAULT NOW() |
| updated_at | TIMESTAMP | |
| created_by | UUID (FK) | REFERENCES users(id) |

#### departments
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| name | TEXT | UNIQUE, NOT NULL |
| description | TEXT | |
| is_active | BOOLEAN | DEFAULT true |
| created_at | TIMESTAMP | DEFAULT NOW() |
| created_by | UUID (FK) | REFERENCES users(id) |
| custom_fields_schema | JSONB | Dynamic field definitions |

#### department_members
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| member_id | UUID (FK) | REFERENCES members(id) |
| department_id | UUID (FK) | REFERENCES departments(id) |
| joined_at | TIMESTAMP | DEFAULT NOW() |
| removed_at | TIMESTAMP | |
| removed | BOOLEAN | DEFAULT false |
| PRIMARY KEY | | (member_id, department_id) |

#### department_leaders
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| user_id | UUID (FK) | REFERENCES users(id) |
| department_id | UUID (FK) | REFERENCES departments(id) |
| role_in_department | TEXT | CHECK (dept_secretary, dept_chairperson) |
| start_date | TIMESTAMP | |
| end_date | TIMESTAMP | |
| created_at | TIMESTAMP | DEFAULT NOW() |

#### department_custom_values
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| member_id | UUID (FK) | REFERENCES members(id) |
| department_id | UUID (FK) | REFERENCES departments(id) |
| field_key | TEXT | |
| field_value | TEXT | |

### 1.3 Activity Tables

#### activities
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| title | TEXT | NOT NULL |
| description | TEXT | |
| activity_date | TIMESTAMP | |
| end_date | TIMESTAMP | |
| audience_type | TEXT | CHECK (all_members, department, leaders, specific_group) |
| department_id | UUID (FK) | REFERENCES departments(id) |
| created_by | UUID (FK) | REFERENCES users(id) |
| created_at | TIMESTAMP | DEFAULT NOW() |
| updated_at | TIMESTAMP | |

#### activity_audiences
| Column | Type | Constraints |
|--------|------|-------------|
| activity_id | UUID (FK) | REFERENCES activities(id) |
| audience_type | TEXT | CHECK |
| audience_value | TEXT | (e.g., department_id, gender) |
| PRIMARY KEY | | (activity_id, audience_type, audience_value) |

#### attendance
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| activity_id | UUID (FK) | REFERENCES activities(id) |
| member_id | UUID (FK) | REFERENCES members(id) |
| recorded_at | TIMESTAMP | DEFAULT NOW() |
| recorded_by | TEXT | (manual entry name or member) |
| is_confirmed | BOOLEAN | DEFAULT true |

### 1.4 Finance Tables

#### contributions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| member_id | UUID (FK) | REFERENCES members(id) |
| amount | DECIMAL(12,2) | NOT NULL |
| contribution_type | TEXT | |
| date | DATE | NOT NULL |
| recorded_by | UUID (FK) | REFERENCES users(id) |
| recorded_at | TIMESTAMP | DEFAULT NOW() |
| approval_status | TEXT | CHECK (states from section 1.9) |

#### expenses
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| title | TEXT | NOT NULL |
| description | TEXT | |
| amount | DECIMAL(12,2) | NOT NULL |
| date | DATE | |
| department_id | UUID (FK) | |
| recorded_by | UUID (FK) | REFERENCES users(id) |
| approval_status | TEXT | |
| approval_workflow_id | UUID (FK) | |

#### budgets
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| title | TEXT | NOT NULL |
| description | TEXT | |
| amount | DECIMAL(12,2) | NOT NULL |
| department_id | UUID (FK) | |
| fiscal_year | TEXT | |
| created_by | UUID (FK) | |
| approval_status | TEXT | |
| approval_workflow_id | UUID (FK) | |

#### money_requests
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| requester_id | UUID (FK) | REFERENCES users(id) |
| department_id | UUID (FK) | |
| title | TEXT | NOT NULL |
| description | TEXT | |
| amount | DECIMAL(12,2) | NOT NULL |
| purpose | TEXT | |
| approval_status | TEXT | |
| approval_workflow_id | UUID (FK) | |
| created_at | TIMESTAMP | DEFAULT NOW() |

#### approvals
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| workflow_type | TEXT | (money_request, expense, budget, report, contribution_edit, it_content) |
| entity_id | UUID | (references the finance/report/it entity) |
| current_stage | INTEGER | |
| status | TEXT | CHECK (state) |
| created_by | UUID (FK) | |
| created_at | TIMESTAMP | DEFAULT NOW() |
| updated_at | TIMESTAMP | |

#### approval_steps
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| approval_id | UUID (FK) | REFERENCES approvals(id) |
| stage_order | INTEGER | |
| approver_role | TEXT | |
| approver_user_id | UUID (FK) | |
| status | TEXT | CHECK (pending, approved, rejected, skipped) |
| comment | TEXT | |
| acted_at | TIMESTAMP | |
| acted_by | UUID (FK) | |

#### finance_statuses
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT (PK) | (enum key) |
| name | TEXT | |
| description | TEXT | |

States: DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, RESUBMITTED, FINAL_APPROVED, CANCELLED

### 1.5 IT Content Tables

#### documents
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| title | TEXT | NOT NULL |
| filename | TEXT | NOT NULL |
| stored_filename | TEXT | NOT NULL |
| file_size | INTEGER | |
| mime_type | TEXT | |
| department_id | UUID (FK) | |
| uploaded_by | UUID (FK) | |
| uploaded_at | TIMESTAMP | DEFAULT NOW() |
| approval_status | TEXT | |
| approval_workflow_id | UUID (FK) | |

#### announcements
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| title | TEXT | NOT NULL |
| content | TEXT | |
| audience_type | TEXT | |
| created_by | UUID (FK) | |
| created_at | TIMESTAMP | DEFAULT NOW() |
| approval_status | TEXT | |

#### notifications
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| recipient_user_id | UUID (FK) | REFERENCES users(id) |
| event_type | TEXT | |
| title | TEXT | NOT NULL |
| message | TEXT | NOT NULL |
| entity_type | TEXT | |
| entity_id | UUID | |
| is_read | BOOLEAN | DEFAULT false |
| created_at | TIMESTAMP | DEFAULT NOW() |
| actor_user_id | UUID (FK) | |

### 1.6 Audit & System Tables

#### audit_logs
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| user_id | UUID (FK) | REFERENCES users(id) |
| action | TEXT | NOT NULL |
| entity_type | TEXT | |
| entity_id | UUID | |
| timestamp | TIMESTAMP | DEFAULT NOW() |
| old_value | JSONB | |
| new_value | JSONB | |
| ip_address | TEXT | |
| device_info | TEXT | |
| approval_info | JSONB | |
| comment | TEXT | |
| impersonation_session_id | UUID (FK) | REFERENCES impersonation_sessions(id) |

#### deleted_records (recycle bin)
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| original_table | TEXT | NOT NULL |
| original_record_id | UUID | NOT NULL |
| original_data | JSONB | NOT NULL |
| deleted_by | UUID (FK) | REFERENCES users(id) |
| deleted_at | TIMESTAMP | DEFAULT NOW() |
| restore_token | TEXT | UNIQUE |

#### impersonation_sessions
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| admin_user_id | UUID (FK) | REFERENCES users(id) |
| target_user_id | UUID (FK) | REFERENCES users(id) |
| approval_by | UUID (FK) | |
| approval_token | TEXT | |
| started_at | TIMESTAMP | |
| expires_at | TIMESTAMP | |
| ended_at | TIMESTAMP | |
| is_active | BOOLEAN | DEFAULT false |
| status | TEXT | CHECK (requested, approved, active, expired, cancelled) |

#### backups
| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID (PK) | PRIMARY KEY |
| created_by | UUID (FK) | |
| created_at | TIMESTAMP | DEFAULT NOW() |
| file_path | TEXT | |
| file_size | INTEGER | |
| storage_location | TEXT | CHECK (cloud, local) |
| status | TEXT | CHECK (success, failed) |
| is_incremental | BOOLEAN | DEFAULT false |

### 1.7 Relationships Summary

- users (1-Many) user_roles -> roles
- roles (Many-Many) role_permissions -> permissions
- users (1-1) members (optional user account)
- members (Many-Many) department_members <- departments
- users (Many-Many) department_leaders <- departments
- members (Many-Many) department_custom_values <- departments
- users (Many-1) activities (created_by)
- departments (1-Many) activities
- activities (1-Many) attendance
- members (1-Many) contributions
- users (1-Many) expenses, budgets, money_requests
- users (1-Many) documents, announcements
- departments (1-Many) documents
- users (1-Many) notifications (recipient)
- approvals (1-Many) approval_steps

### 1.8 Indexes

- users(email) for login
- members(member_code) for lookups
- departments(name) for lookups
- audit_logs(timestamp) for audit queries
- audit_logs(user_id) for user activity
- notifications(recipient_user_id, is_read, created_at) for notification center
- deleted_records(deleted_at) for recycle bin cleanup
- approvals(entity_id, workflow_type) for approval lookup

### 1.9 Approval States

Each entity type uses the shared approval workflow engine with states:
- **DRAFT**: Initial state, not yet submitted
- **SUBMITTED**: Submitted for review
- **UNDER_REVIEW**: With a reviewer
- **APPROVED**: Passed current stage
- **REJECTED**: At any stage
- **RESUBMITTED**: After rejection
- **FINAL_APPROVED**: Complete approval
- **CANCELLED**: Cancelled

## 2. Constraints

- Foreign keys with ON DELETE CASCADE/RESTRICT as appropriate
- NOT NULL on required fields
- CHECK constraints on enum-like fields
- UNIQUE constraints on business keys
- Department-scoped queries always filter by department_id for department leaders
