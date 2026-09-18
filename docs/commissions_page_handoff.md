# Commissions Page Feature — Handoff Document

**Created**: 2024  
**Status**: Requirements Gathered — Ready for Development  
**Owner**: TBD  
**Last Updated**: 2024-01-16

---

## ✅ ANSWERS PROVIDED — Business Requirements Confirmed

### Commission Calculation
- **Q1: Rate Structure**: Commission rates stored in `commission_rates` table, varying by rep. Rates synced from Paycom via pipeline.
- **Q2: When Earned**: Commission created when estimate status changes to `'won'`
- **Q3: Split Logic**: **No splits**. Commission goes 100% to `crm_rep` (the salesperson who brought in the lead). Estimators (`assigned_ls_estimator`, `assigned_irr_estimator`) do NOT earn commissions.
- **Q4: Recurring**: One-time commission calculated on total annual contract value when deal closes (status = 'won')

### Payment & Workflow
- **Q5: Approval**: Auto-approved when estimate → 'won' (status = 'approved' on creation)
- **Q6: Payment Schedule**: **Monthly payouts**. Finance marks commissions as 'paid' each month.
- **Q7: Clawbacks**: Not implemented in v1 (future enhancement)

### Data Sources
- **Q8: Tables**: `estimates` table drives commissions (when status = 'won')
- **Q9: Rep Field**: Commission goes to **`leads.crm_rep`** (the sales rep who owns the lead relationship)
- **Q10: Contract Value**: Sum of all `estimate_line_items` (with markup/pricing)

### UI & Permissions
- **Q11: Real-time**: Yes, YTD metrics update immediately when deals close
- **Q12: Self-service**: Reps can view their own commissions; no dispute flow in v1
- **Q13: Visibility**: 
  - **Sales reps**: Own commissions only
  - **Admins/Executives**: Dropdown to view any rep's commissions
- **Q14: Filters**: Date range (MTD/QTD/YTD/Custom), status, estimate type

### Integrations
- **Q15: Aspire**: Internal only (no Aspire sync)
- **Q16: Payroll**: No export in v1; commission data lives in CRM only

### Paycom Integration
- **Source**: Separate MySQL Paycom database (external system)
- **Strategy**: Create `commission_rates` table in CRM; build sync pipeline to backfill and keep rates updated
- **Schema**: Per-rep rates with effective dates (see Section 3.1)

---

## 1. Feature Overview

### Purpose
Provide sales representatives, managers, and finance staff with real-time visibility into commission earnings, payment status, and performance metrics. The Commissions page displays:

1. **Summary Metrics** (Top KPI Cards)
   - Scheduled Commissions YTD (sum of all approved/paid commissions)
   - Total Paid YTD (sum of paid commissions only)

2. **Breakdown by Contract Type**
   - Maintenance Contract Commissions
   - Install Project Commissions
   - Other categories TBD

3. **Individual Rep Performance**
   - Per-rep earnings breakdown
   - Property/contract-level detail
   - Payment status (Paid, Upcoming, Approved)

4. **Period-Based Payouts**
   - Monthly payment records
   - Payment period tracking (e.g., "January 2024")

### User Roles
- **Sales Reps**: View own commissions only
- **Managers**: View team commissions
- **Finance/Admin**: View all commissions, manage approvals
- **VP/CEO**: View all with full access

---

## 2. CRITICAL QUESTIONS (Must Answer Before Coding)

### 2.1 Data Model & Business Logic

#### Commission Calculation
- [ ] **Q1**: How are commissions calculated?
  - Flat percentage of contract value?
  - Tiered based on deal size?
  - Different rates for maintenance vs install?
  - Special rates for different service types?
  - Example: "5% of first $50k, 7% above $50k" or "3% for maintenance, 5% for install"

- [ ] **Q2**: When is a commission "earned"?
  - At estimate approval?
  - At contract signature?
  - At first invoice payment?
  - At service completion?

- [ ] **Q3**: Commission split scenarios?
  - Do multiple reps share commissions on one deal?
  - If yes, what's the split logic? (e.g., 60/40 between primary/secondary)
  - Does the CRM who closed it get a share vs estimator?

- [ ] **Q4**: Recurring commission for maintenance contracts?
  - One-time commission on annual contract value?
  - Monthly commission as invoices are paid?
  - Annual renewal commissions?

#### Payment Status & Workflow
- [ ] **Q5**: Commission approval workflow?
  - Auto-approved when deal is won?
  - Requires manager approval?
  - Requires finance verification?
  - Multi-stage approval?

- [ ] **Q6**: Payment schedule?
  - Monthly payouts?
  - Quarterly?
  - Per deal as collected?
  - What determines "Paid" vs "Upcoming" vs "Approved"?

- [ ] **Q7**: Clawback/adjustment scenarios?
  - Customer cancels within X days?
  - Invoice goes unpaid?
  - Service not delivered?
  - How are these reflected in the UI?

### 2.2 Data Sources

- [ ] **Q8**: Which existing tables drive commissions?
  - `estimates` table (when status = 'won')?
  - `proposals` table?
  - Do you have invoice/payment data we should track?
  - Aspire sync data?

- [ ] **Q9**: Rep assignment?
  - Is commission based on `estimates.assigned_to`?
  - Or `estimates.aspire_owner`?
  - Or a new field like `estimates.commission_rep_id`?
  - Can this change after estimate creation?

- [ ] **Q10**: Contract value source?
  - Sum of `estimate_line_items` with markup?
  - A single `estimates.total_value` field?
  - From Aspire after sync?

### 2.3 UI & Permissions

- [ ] **Q11**: Real-time vs historical?
  - Should YTD metrics update live as deals close?
  - Or only after finance approves/processes?

- [ ] **Q12**: Rep self-service?
  - Can reps dispute/comment on commission amounts?
  - Can they see pending vs paid breakdown?
  - Should they see "expected commission" before approval?

- [ ] **Q13**: Data visibility by role?
  - Sales reps see ONLY their own commissions?
  - Managers see their direct reports?
  - Managers see all reps in their branch?
  - Finance sees everything?

- [ ] **Q14**: Filters & Views?
  - Filter by date range (MTD, QTD, YTD, Custom)?
  - Filter by payment status?
  - Filter by rep (for managers)?
  - Filter by contract type (maintenance vs install)?
  - Group by property/customer?

### 2.4 Integrations

- [ ] **Q15**: Aspire integration?
  - Does Aspire track commissions?
  - Should we sync commission data to/from Aspire?
  - Or is this purely CRM-internal?

- [ ] **Q16**: Payroll integration?
  - Export commission data for payroll processing?
  - Generate commission reports for accounting?
  - API needed for external systems?

---

## 3. Technical Architecture (Based on Existing Patterns)

### 3.1 Database Schema

**✅ Created: `sql/migrations/046_commissions_schema.sql`** (218 lines)

Complete schema with 2 tables + trigger + helper views.

#### Summary:

```sql
-- Commission rates per rep (synced from Paycom via pipeline)
-- NOTE: Initial backfill from Paycom MySQL; ongoing sync keeps rates current
CREATE TABLE commission_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id), -- the sales rep
  commission_rate DECIMAL(5,4) NOT NULL, -- 0.0500 = 5%, stored as decimal
  effective_date DATE NOT NULL,
  expires_date DATE,           -- null = currently active
  
  -- Paycom sync metadata
  paycom_employee_id VARCHAR(50), -- link back to Paycom record
  synced_at TIMESTAMPTZ DEFAULT now(),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT valid_rate CHECK (commission_rate >= 0 AND commission_rate <= 1)
);

CREATE INDEX idx_commission_rates_user_id ON commission_rates(user_id);
CREATE INDEX idx_commission_rates_effective_date ON commission_rates(effective_date);

-- Commission records (one row per commission earned)
-- Auto-created via trigger when estimate status → 'won'
CREATE TABLE commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id),
  lead_id UUID NOT NULL REFERENCES leads(id),
  user_id UUID NOT NULL REFERENCES users(id), -- the crm_rep who earned the commission
  
  -- Money fields (integer cents)
  contract_value_cents INT NOT NULL, -- sum of estimate_line_items
  commission_rate DECIMAL(5,4) NOT NULL, -- rate at time of sale (from commission_rates)
  commission_amount_cents INT NOT NULL, -- contract_value_cents * commission_rate
  
  -- Status tracking
  -- 'approved' = auto-set on creation (when estimate → won)
  -- 'paid' = manually marked by finance during monthly payout
  status TEXT NOT NULL DEFAULT 'approved', -- 'approved' | 'paid' | 'cancelled'
  approved_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ,
  payment_period TEXT, -- 'January 2024', 'February 2024', etc.
  
  -- Audit
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT valid_status CHECK (status IN ('approved', 'paid', 'cancelled')),
  UNIQUE(estimate_id) -- one commission per estimate
);

CREATE INDEX idx_commissions_user_id ON commissions(user_id);
CREATE INDEX idx_commissions_estimate_id ON commissions(estimate_id);
CREATE INDEX idx_commissions_status ON commissions(status);
CREATE INDEX idx_commissions_paid_at ON commissions(paid_at);

-- Trigger: Auto-create commission when estimate status changes to 'won'
CREATE OR REPLACE FUNCTION trigger_create_commission()
RETURNS TRIGGER AS $$
DECLARE
  v_lead_id UUID;
  v_crm_rep_id UUID;
  v_contract_value_cents INT;
  v_commission_rate DECIMAL(5,4);
  v_commission_amount_cents INT;
BEGIN
  -- Only fire when status changes TO 'won' (not already won)
  IF NEW.status = 'won' AND (OLD.status IS NULL OR OLD.status != 'won') THEN
    
    -- Get the lead and crm_rep
    SELECT id, crm_rep INTO v_lead_id, v_crm_rep_id
    FROM leads
    WHERE id = NEW.lead_id;
    
    -- If no crm_rep, cannot create commission (skip)
    IF v_crm_rep_id IS NULL THEN
      RETURN NEW;
    END IF;
    
    -- Calculate contract value: sum of all estimate line items
    -- (Assuming estimate_line_items has a total_cents or similar column)
    SELECT COALESCE(SUM(total_price_cents), 0) INTO v_contract_value_cents
    FROM estimate_line_items
    WHERE estimate_id = NEW.id;
    
    -- Get the current commission rate for this rep
    -- (Use the most recent active rate as of today)
    SELECT commission_rate INTO v_commission_rate
    FROM commission_rates
    WHERE user_id = v_crm_rep_id
      AND effective_date <= CURRENT_DATE
      AND (expires_date IS NULL OR expires_date > CURRENT_DATE)
    ORDER BY effective_date DESC
    LIMIT 1;
    
    -- If no rate found, skip (cannot calculate commission)
    IF v_commission_rate IS NULL THEN
      RETURN NEW;
    END IF;
    
    -- Calculate commission amount
    v_commission_amount_cents := ROUND(v_contract_value_cents * v_commission_rate);
    
    -- Insert commission record (status = 'approved' by default)
    INSERT INTO commissions (
      estimate_id,
      lead_id,
      user_id,
      contract_value_cents,
      commission_rate,
      commission_amount_cents,
      status,
      approved_at
    ) VALUES (
      NEW.id,
      v_lead_id,
      v_crm_rep_id,
      v_contract_value_cents,
      v_commission_rate,
      v_commission_amount_cents,
      'approved',
      NOW()
    )
    ON CONFLICT (estimate_id) DO NOTHING; -- prevent duplicates
    
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER estimate_won_commission
  AFTER UPDATE ON estimates
  FOR EACH ROW
  EXECUTE FUNCTION trigger_create_commission();
```

### 3.2 Data You Need to Populate

**✅ The `commission_rates` table is created by migration 046.**

**YOU need to populate it with data from Paycom.** Here's what to insert:

#### Required Columns:

| Column | Type | Description | Example |
|--------|------|-------------|----------|
| `user_id` | CHAR(36) | CRM user ID (from `users` table) | Match by email |
| `commission_rate` | DECIMAL(6,5) | Rate as decimal | `0.05000` = 5% |
| `effective_date` | DATE | When rate starts | `2024-01-01` |
| `expires_date` | DATE (nullable) | When rate ends | `NULL` = active |
| `paycom_employee_id` | VARCHAR(100) | Paycom reference | `'EMP12345'` |
| `paycom_synced_at` | TIMESTAMP | When synced | `NOW()` |

#### Example Seed Query:

```sql
-- Seed commission rate for John Doe (5% commission)
INSERT INTO commission_rates (
  user_id,
  commission_rate,
  effective_date,
  expires_date,
  paycom_employee_id,
  paycom_synced_at
)
SELECT 
  u.id,
  0.05,                    -- 5% = 0.05
  '2024-01-01',            -- Effective date
  NULL,                    -- NULL = currently active
  'PAYCOM_EMP_12345',      -- Paycom employee ID
  NOW()
FROM users u
WHERE u.email = 'john.doe@juniperlandscaping.com'
  AND u.role IN ('sales', 'inside_sales');
```

#### What You Need from Paycom:

1. **Employee email** → to match CRM `users.email`
2. **Commission rate** → as decimal (5% = `0.05`)
3. **Effective date** → when rate became active
4. **End date** → `NULL` if current rate, date if expired
5. **Paycom employee ID** → for audit trail

#### Multiple Rates Per User (History):

If a rep's rate changed over time, insert multiple rows:

```sql
-- Jane Smith: 4% until June 30, then 6%
INSERT INTO commission_rates (user_id, commission_rate, effective_date, expires_date, paycom_employee_id, paycom_synced_at)
SELECT u.id, 0.04, '2023-01-01', '2024-06-30', 'EMP_67890', NOW()
FROM users u WHERE u.email = 'jane.smith@juniperlandscaping.com';

INSERT INTO commission_rates (user_id, commission_rate, effective_date, expires_date, paycom_employee_id, paycom_synced_at)
SELECT u.id, 0.06, '2024-07-01', NULL, 'EMP_67890', NOW()
FROM users u WHERE u.email = 'jane.smith@juniperlandscaping.com';
```

The trigger will automatically pick the correct rate based on the won date.

#### Verification Query:

After populating, verify with:

```sql
-- View all current active rates
SELECT * FROM v_current_commission_rates ORDER BY user_name;

-- Expected output:
-- user_name    | commission_rate | effective_date | expires_date
-- Jane Smith   | 0.06000        | 2024-07-01     | NULL
-- John Doe     | 0.05000        | 2024-01-01     | NULL
```

---

### 3.3 How Commissions Are Auto-Created

**The migration includes a trigger** that runs automatically:

**When**: Estimate status changes to `'won'`  
**What it does**:
1. Looks up `leads.crm_rep` for the estimate's lead
2. Sums `estimate_line_items.total_price_cents` → contract value
3. Fetches current `commission_rate` for that rep (based on today's date)
4. Calculates: `commission_amount = contract_value * rate`
5. Inserts into `commissions` table with `status='approved'`

**No manual steps needed** - happens automatically on every won deal!

---

### OLD 3.2 DELETED - Paycom Sync Script (No Longer Needed)

~~The complex Paycom MySQL sync script has been removed.~~  
**You handle populating `commission_rates` however works best for you.**

---

### 3.4 Backend API Endpoints (was 3.3)

```python
"""
Paycom Commission Rate Sync

Connects to Paycom MySQL database, fetches commission rates for all sales reps,
and syncs them to the local commission_rates table.

Run: python scripts/sync_paycom_rates.py [--backfill]

Flags:
  --backfill: Full sync (all historical rates)
  (default): Incremental sync (only recent changes)
"""

import os
import sys
from datetime import datetime
import pymysql  # or mysql-connector-python
from api.db import get_connection  # your local DB connection

# Paycom MySQL connection config (from env vars)
PAYCOM_CONFIG = {
    'host': os.getenv('PAYCOM_MYSQL_HOST'),
    'port': int(os.getenv('PAYCOM_MYSQL_PORT', 3306)),
    'user': os.getenv('PAYCOM_MYSQL_USER'),
    'password': os.getenv('PAYCOM_MYSQL_PASSWORD'),
    'database': os.getenv('PAYCOM_MYSQL_DATABASE'),
}

def sync_commission_rates(backfill=False):
    """
    Fetch commission rates from Paycom and upsert to commission_rates table.
    
    Schema assumptions (REPLACE WITH ACTUAL PAYCOM SCHEMA):
    - Paycom table: `employee_commission_rates`
    - Columns:
      - employee_id: VARCHAR
      - commission_rate: DECIMAL
      - effective_date: DATE
      - end_date: DATE (null = active)
      - email: VARCHAR (to match to CRM users)
    """
    
    # Connect to Paycom MySQL
    paycom_conn = pymysql.connect(**PAYCOM_CONFIG)
    paycom_cursor = paycom_conn.cursor(pymysql.cursors.DictCursor)
    
    # Connect to local CRM DB
    local_conn = get_connection()
    local_cursor = local_conn.cursor()
    
    try:
        # Fetch rates from Paycom
        # TODO: REPLACE WITH ACTUAL PAYCOM TABLE/COLUMN NAMES
        query = """
            SELECT 
                employee_id,
                email,
                commission_rate,
                effective_date,
                end_date
            FROM employee_commission_rates
            WHERE 1=1
        """
        
        if not backfill:
            # Incremental: only fetch rates updated in last 7 days
            query += " AND updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
        
        paycom_cursor.execute(query)
        paycom_rates = paycom_cursor.fetchall()
        
        print(f"Fetched {len(paycom_rates)} rates from Paycom")
        
        synced_count = 0
        skipped_count = 0
        
        for rate in paycom_rates:
            # Map Paycom employee to CRM user by email
            local_cursor.execute(
                "SELECT id FROM users WHERE email = %s AND role IN ('sales', 'inside_sales')",
                (rate['email'],)
            )
            user_row = local_cursor.fetchone()
            
            if not user_row:
                print(f"Warning: No CRM user found for Paycom email {rate['email']}")
                skipped_count += 1
                continue
            
            user_id = user_row[0]
            
            # Upsert to commission_rates
            local_cursor.execute("""
                INSERT INTO commission_rates (
                    user_id,
                    commission_rate,
                    effective_date,
                    expires_date,
                    paycom_employee_id,
                    synced_at
                ) VALUES (
                    %s, %s, %s, %s, %s, NOW()
                )
                ON DUPLICATE KEY UPDATE
                    commission_rate = VALUES(commission_rate),
                    expires_date = VALUES(expires_date),
                    synced_at = NOW()
            """, (
                user_id,
                rate['commission_rate'],
                rate['effective_date'],
                rate['end_date'],
                rate['employee_id']
            ))
            
            synced_count += 1
        
        local_conn.commit()
        print(f"✅ Synced {synced_count} rates, skipped {skipped_count}")
        
    finally:
        paycom_cursor.close()
        paycom_conn.close()
        local_cursor.close()
        local_conn.close()

if __name__ == '__main__':
    backfill = '--backfill' in sys.argv
    sync_commission_rates(backfill=backfill)
```

**Scheduling**: Add to cron or Cloud Scheduler
```bash
# Daily sync at 2 AM
0 2 * * * cd /app && python scripts/sync_paycom_rates.py
```

**Required Environment Variables**:
```bash
PAYCOM_MYSQL_HOST=paycom-db.example.com
PAYCOM_MYSQL_PORT=3306
PAYCOM_MYSQL_USER=readonly_user
PAYCOM_MYSQL_PASSWORD=<secret>
PAYCOM_MYSQL_DATABASE=paycom_prod
```

---

### 3.3 Backend API Endpoints

**New file: `api/commissions.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from datetime import date
from api.authz import require_user, User

router = APIRouter(prefix='/api/commissions', tags=['commissions'])

# GET /api/commissions/summary
# Returns YTD summary metrics for current user (or specified user if manager/admin)
@router.get('/summary')
def get_commission_summary(
    user_id: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    current_user: User = Depends(require_user)
):
    """
    Returns:
    {
      scheduled_ytd_cents: int,  # sum of all approved + paid commissions YTD
      paid_ytd_cents: int,       # sum of paid commissions only YTD
    }
    
    Permission logic:
    - Sales reps: can only query own user_id
    - Admin/Executive: can query any user_id via dropdown
    """
    # TODO: implement authorization check
    # TODO: implement YTD date range calculation
    # TODO: query commissions table with filters
    pass

# GET /api/commissions/list
# Returns detailed commission records
@router.get('/list')
def get_commissions(
    user_id: Optional[str] = None,
    status: Optional[str] = None,  # 'pending' | 'approved' | 'paid'
    estimate_type: Optional[str] = None,  # 'maintenance' | 'install'
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    current_user: User = Depends(require_user)
):
    """
    Returns array of:
    {
      id: str,
      estimate: { id, estimate_number, property_name, ... },
      contract_value_cents: int,
      commission_amount_cents: int,
      status: str,
      approved_at: str | null,
      paid_at: str | null,
      payment_period: str | null,
    }
    """
    pass

# POST /api/commissions/{id}/approve
# Manager/finance approves a pending commission
@router.post('/{commission_id}/approve')
def approve_commission(
    commission_id: str,
    current_user: User = Depends(require_user)
):
    # Check authz: only manager/finance/admin
    pass

# POST /api/commissions/{id}/mark-paid
# Finance marks commission as paid
@router.post('/{commission_id}/mark-paid')
def mark_commission_paid(
    commission_id: str,
    payment_period: str,
    current_user: User = Depends(require_user)
):
    # Check authz: only finance/admin
    pass
```

### 3.4 Frontend Components

**New file: `studio/src/views/inside-sales/CommissionsPage.tsx`**

Following existing patterns from `DashboardPage.tsx`:

```tsx
import { TopNav } from '@/components/layout/TopNav'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCommissions } from '@/hooks/useCommissions'
// ... more imports

export default function CommissionsPage() {
  const { data: summary, isLoading } = useCommissions()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav title="Commissions" />
      
      <ScrollArea className="flex-1">
        <div className="p-5 space-y-5">
          {/* KPI Cards - Use GroupedStatCard pattern from DashboardPage */}
          <div className="grid grid-cols-2 gap-4">
            <GroupedStatCard 
              label="SCHEDULED YTD"
              dotColor="bg-blue-500"
              stats={[{
                title: "Commissions",
                value: formatCurrency(summary?.scheduledYtdCents || 0),
              }]}
            />
            <GroupedStatCard 
              label="PAID YTD"
              dotColor="bg-green-500"
              stats={[{
                title: "Paid Out",
                value: formatCurrency(summary?.paidYtdCents || 0),
              }]}
            />
          </div>

          {/* Contract Type Breakdown */}
          <CommissionBreakdownSection />
          
          {/* Rep Performance Table */}
          <CommissionDetailTable />
        </div>
      </ScrollArea>
    </div>
  )
}
```

**New components needed:**

1. `CommissionBreakdownSection.tsx`
   - Accordion-style sections for "Maintenance Contract Commissions", "Install Project Commissions"
   - Each section shows per-property breakdown
   - Uses existing `Card` + Tailwind styling

2. `CommissionDetailTable.tsx`
   - Sortable table (use `@tanstack/react-table` if you use it elsewhere)
   - Columns: Property, Contract Value, Commission Rate, Commission Amount, Status, Payment Period
   - Status badges using your existing badge styling

3. `CommissionFilters.tsx`
   - Date range picker (MTD, QTD, YTD, Custom)
   - Status filter dropdown
   - Rep filter (for managers)

**New hook: `studio/src/hooks/useCommissions.ts`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

export function useCommissions(filters?: {
  userId?: string
  status?: string
  startDate?: string
  endDate?: string
}) {
  return useQuery({
    queryKey: ['commissions', 'summary', filters],
    queryFn: () => api.get('/api/commissions/summary', { params: filters }),
  })
}

export function useCommissionList(filters?: { /* ... */ }) {
  return useQuery({
    queryKey: ['commissions', 'list', filters],
    queryFn: () => api.get('/api/commissions/list', { params: filters }),
  })
}
```

**New types: `studio/src/types/commissions.ts`**

```typescript
export interface Commission {
  id: string
  estimateId: string
  leadId: string
  userId: string  // the crm_rep who earned the commission
  contractValueCents: number
  commissionRate: number  // 0.05 = 5%, stored as decimal
  commissionAmountCents: number
  status: 'approved' | 'paid' | 'cancelled'
  approvedAt: string | null
  paidAt: string | null
  paymentPeriod: string | null  // 'January 2024', 'February 2024', etc.
  notes: string | null
  createdAt: string
  updatedAt: string
  
  // Joined data from estimates + leads tables
  estimate?: {
    id: string
    estimateNumber: string
    propertyName: string
    estimateType: 'maintenance' | 'install'
  }
  lead?: {
    id: string
    propertyName: string
  }
  rep?: {
    id: string
    name: string
    email: string
  }
}

export interface CommissionSummary {
  scheduledYtdCents: number  // sum of approved + paid commissions YTD
  paidYtdCents: number       // sum of paid commissions only YTD
}

export interface CommissionRate {
  id: string
  userId: string
  commissionRate: number  // 0.05 = 5%
  effectiveDate: string
  expiresDate: string | null
  paycomEmployeeId: string | null
  syncedAt: string
}
```

### 3.5 Navigation Integration

**Update: `studio/src/components/layout/Sidebar.tsx`**

Add to `navItems` array:

```typescript
import { DollarSign } from 'lucide-react'  // or another appropriate icon

const navItems: NavItem[] = [
  // ... existing items
  { 
    label: 'Commissions', 
    icon: DollarSign, 
    href: '/inside-sales/commissions', 
    roles: SALES_NAV  // or create COMMISSIONS_NAV if different access
  },
  // ... rest of items
]
```

**Update: `studio/src/router.tsx`**

Add route:

```typescript
import CommissionsPage from '@/views/inside-sales/CommissionsPage'

// Inside the Routes:
<Route path="/inside-sales/commissions" element={<CommissionsPage />} />
```

---

## 4. UI Design Notes (Using Current Conventions)

### Color & Styling
Based on existing patterns:
- Use HSL CSS variables: `hsl(var(--fg))`, `hsl(var(--bg))`, `hsl(var(--muted-fg))`
- KPI cards: Match `GroupedStatCard` pattern from DashboardPage
- Status badges:
  - Pending: Yellow/amber
  - Approved: Blue
  - Paid: Green
  - Disputed: Red
  - Use existing Tailwind badge classes

### Layout
- Follow DashboardPage structure:
  - TopNav with page title
  - ScrollArea for main content
  - 5-unit padding (`p-5`)
  - 5-unit spacing between sections (`space-y-5`)

### Typography
- Page title: `text-2xl font-semibold`
- Section headers: `text-sm font-semibold tracking-widest uppercase text-[hsl(var(--muted-fg))]`
- Metric values: `text-2xl font-bold`
- Labels: `text-xs text-[hsl(var(--muted-fg))]`

### Interactive Elements
- Use existing `Button`, `Card`, `Select`, `DateRangePicker` components
- Hover states: `hover:shadow-md transition-shadow`
- Clickable cards: `cursor-pointer`

---

## 5. Implementation Phases

### Phase 1: Foundation (Week 1)
- [x] Answer all questions in Section 2 ✅
- [x] Create database migration 046 ✅ (commission_rates + commissions tables)
- [ ] **YOU: Populate `commission_rates` table from Paycom** (see Section 3.2)
- [ ] Run migration 046
- [ ] Verify trigger works: manually set test estimate → 'won', check commissions table
- [ ] Create basic API endpoints (summary, list)
- [ ] Write backend unit tests

### Phase 2: Basic UI (Week 2)
- [ ] Create CommissionsPage with KPI cards
- [ ] Add navigation (Sidebar + router)
- [ ] Create useCommissions hook
- [ ] Wire up API to display real data
- [ ] Role-based access control (reps see own, managers see team)

### Phase 3: Detail Views (Week 3)
- [ ] CommissionBreakdownSection component
- [ ] CommissionDetailTable component
- [ ] Filters (date range, status, rep)
- [ ] Sorting and pagination

### Phase 4: Finance Workflows (Week 4)
- [ ] Mark as paid UI (finance only)
- [ ] Payment period assignment
- [ ] Bulk mark-as-paid for monthly payouts
- [ ] Notes/adjustments functionality
- [ ] Email notifications (optional)

### Phase 5: Polish & Testing (Week 5)
- [ ] Frontend unit tests
- [ ] Integration tests
- [ ] Manual QA with real data
- [ ] Performance optimization
- [ ] Documentation

---

## 6. Testing Strategy

### Backend Tests
```python
# tests/test_commissions.py
def test_commission_calculation():
    # Test various scenarios: maintenance, install, tiers
    pass

def test_commission_auto_creation():
    # Test commission auto-created when estimate → won
    pass

def test_commission_rate_lookup():
    # Test correct rate selected based on effective_date
    pass

def test_mark_paid_authz():
    # Only finance can mark as paid
    pass
```

### Frontend Tests
```typescript
// studio/src/test/views/inside-sales/CommissionsPage.test.tsx
describe('CommissionsPage', () => {
  it('renders KPI cards with correct values', () => {});
  it('filters commissions by date range', () => {});
  it('shows only own commissions for sales rep role', () => {});
  it('shows team commissions for manager role', () => {});
});
```

---

## 7. Migration & Rollout Plan

### Data Migration
- [ ] **No backfill needed** per requirements (only new won estimates)
- [ ] Paycom sync: backfill commission_rates table with historical rep rates
- [ ] Dry-run validation: trigger commission creation on test estimates

### Rollout
1. **Staging**: Deploy with test data, validate with finance team
2. **Pilot**: Enable for one branch or small team
3. **Full Rollout**: Enable for all users
4. **Monitor**: Watch for performance issues, data discrepancies

---

## 8. Dependencies & Prerequisites

### Before Development:
- [ ] **Populate `commission_rates` table** from Paycom data (see Section 3.2)
- [ ] Finance team review of commission calculation logic
- [ ] Confirm: Does `leads.crm_rep` always exist for won estimates?
- [ ] Confirm: Column name in `estimate_line_items` for line total (is it `total_price_cents`?)

### Data You Must Provide:
✅ **Commission rates for all sales reps** - see Section 3.2 for exact format  
✅ **Email addresses** - to match Paycom employees to CRM `users` table

---

## 9. Open Questions & Risks

### Risks
1. **Data Accuracy**: Incorrect commission calculations could cause legal/financial issues
   - Mitigation: Extensive testing, finance review, soft launch
2. **Performance**: Large datasets (years of commission records)
   - Mitigation: Pagination, indexing, date range defaults
3. **Scope Creep**: Commission rules may be complex and evolve
   - Mitigation: Start simple (flat rate), iterate based on feedback

### Open Questions
- Do we need export to CSV/Excel?
- Do we need commission reports for accounting?
- Should we track commission adjustments/corrections separately?
- What's the retention policy for old commission records?

---

## 10. Success Metrics

- [ ] Reps can view their YTD commissions in < 2 seconds
- [ ] Finance team approves 100% of commissions through UI (no manual spreadsheets)
- [ ] Zero commission calculation disputes in first month
- [ ] 90%+ user satisfaction in post-launch survey

---

## 11. Reference Image Analysis

From the provided screenshot, key observations:

1. **Top Metrics Row**:
   - 4 cards: Scheduled YTD, Paid YTD, Gross Profit, Net to Rep
   - Green border styling on some cards
   - **Our approach**: Use `GroupedStatCard` pattern, add green accent via `dotColor` prop

2. **Maintenance Contract Commissions Section**:
   - Collapsible/expandable sections
   - User avatar + name (Marcus T.)
   - Three metrics: $2,398 | 0.51% | $4,943
   - Property list: MILAN, STUART, LAKEWOOD RANCH with values
   - Summary row: "Paid: $2,308 · Upcoming: $1,111 · Approved: $1,034"
   - **Our approach**: `Accordion` component from shadcn/ui, `Card` for each user section

3. **Color Coding**:
   - Green text for certain values (positive/paid?)
   - Yellow/amber highlights
   - **Our approach**: Use Tailwind conditional classes based on status

4. **Typography**:
   - Large bold numbers for key metrics
   - Small uppercase labels
   - **Our approach**: Match existing typography scale

---

## Next Steps

✅ **All questions answered!** Ready to begin development.

### Immediate Actions Required:

1. **Get Paycom database access**
   - [ ] Request read-only credentials for Paycom MySQL database
   - [ ] Get data dictionary: table/column names for commission rates
   - [ ] Identify employee_id ↔️ CRM user email mapping

2. **Verify database schema assumptions**
   - [ ] Confirm `leads.crm_rep` column exists and is populated
   - [ ] Confirm `estimate_line_items` has total/price column (what's it called?)
   - [ ] Check if `estimates.lead_id` foreign key exists

3. **Start development** (see Phase 1 in Section 5)

**Estimated timeline**: 4-5 weeks for full implementation

---

## 12. Quick Start Checklist for Developer

### Day 1: Setup & Schema
- [ ] Read this entire document
- [ ] Clone repo, checkout new branch `feat/commissions-page`
- [ ] Create migration `046_commissions_schema.sql` (copy from Section 3.1)
- [ ] Test migration locally
- [ ] Get Paycom MySQL credentials, test connection

### Week 1: Backend Foundation
- [ ] Create `scripts/sync_paycom_rates.py` (copy from Section 3.2)
- [ ] Run backfill: `python scripts/sync_paycom_rates.py --backfill`
- [ ] Verify commission_rates table populated
- [ ] Test trigger: manually set estimate status → 'won', check commissions table
- [ ] Create `api/commissions.py` with GET /summary and GET /list
- [ ] Write unit tests in `tests/test_commissions.py`

### Week 2: Frontend Structure
- [ ] Create `studio/src/types/commissions.ts` (copy from Section 3.4)
- [ ] Create `studio/src/hooks/useCommissions.ts`
- [ ] Create `studio/src/views/inside-sales/CommissionsPage.tsx` (basic shell)
- [ ] Add navigation: update Sidebar.tsx and router.tsx (Section 3.5)
- [ ] Test: can navigate to /inside-sales/commissions

### Week 3: UI Components
- [ ] Build KPI cards (2 cards: Scheduled YTD, Paid YTD)
- [ ] Build CommissionBreakdownSection (accordion by estimate type)
- [ ] Build CommissionDetailTable (property, value, rate, amount, status)
- [ ] Add filters (date range, status)
- [ ] Wire to real API

### Week 4: Finance Workflows
- [ ] Add "Mark as Paid" button (finance role only)
- [ ] Payment period input
- [ ] Bulk operations for monthly payout
- [ ] Notes/adjustments

### Week 5: Testing & Polish
- [ ] Frontend unit tests
- [ ] Manual QA with real data
- [ ] Performance testing (large datasets)
- [ ] Documentation
- [ ] Deploy to staging
- [ ] Finance team review

---

**Document Version**: 2.0  
**Last Updated**: 2024-01-16  
**Author**: Genie Code  
**Status**: ✅ Ready for Development  
**Reviewers**: [Names TBD]
