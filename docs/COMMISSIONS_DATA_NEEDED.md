# Commissions Feature - Data You Need to Provide

## ✅ What I Created for You

### 1. **Migration 046** (`sql/migrations/046_commissions_schema.sql`)
- `commission_rates` table (empty, ready for your data)
- `commissions` table (auto-populated by trigger)
- Trigger that creates commissions when estimates win
- Helper views for reporting

### 2. **Complete Handoff Document** (`docs/commissions_page_handoff.md`)
- Business requirements (all answered)
- Technical architecture
- Implementation plan
- UI components needed

---

## 🔴 What YOU Need to Do

### Step 1: Export Data from Paycom

Get this data for **every sales rep**:

| Field | Description | Example |
|-------|-------------|---------|
| **Email** | To match CRM users | `john.doe@juniperlandscaping.com` |
| **Commission Rate** | As percentage | `5%` (will convert to `0.05`) |
| **Effective Date** | When rate started | `2024-01-01` |
| **End Date** | When rate ended (if changed) | `NULL` if still active |
| **Paycom Employee ID** | For reference | `EMP12345` |

### Step 2: Populate `commission_rates` Table

Run INSERT queries like this for each rep:

```sql
-- Example: John Doe at 5% commission
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
  0.05,                    -- 5% = 0.05 decimal
  '2024-01-01',            -- Start date
  NULL,                    -- NULL = currently active
  'PAYCOM_EMP_12345',      -- Paycom reference
  NOW()
FROM users u
WHERE u.email = 'john.doe@juniperlandscaping.com'
  AND u.role IN ('sales', 'inside_sales');
```

### Step 3: If Rates Changed Over Time

Insert multiple rows per person:

```sql
-- Jane Smith: 4% until June 30, then raised to 6%

-- Old rate
INSERT INTO commission_rates (user_id, commission_rate, effective_date, expires_date, paycom_employee_id, paycom_synced_at)
SELECT u.id, 0.04, '2023-01-01', '2024-06-30', 'EMP_67890', NOW()
FROM users u WHERE u.email = 'jane.smith@juniperlandscaping.com';

-- New rate
INSERT INTO commission_rates (user_id, commission_rate, effective_date, expires_date, paycom_employee_id, paycom_synced_at)
SELECT u.id, 0.06, '2024-07-01', NULL, 'EMP_67890', NOW()
FROM users u WHERE u.email = 'jane.smith@juniperlandscaping.com';
```

The system will automatically pick the right rate based on when the deal won.

---

## 🎯 Key Points

### Commission Rate Format
- Store as **decimal**, not percentage
- 5% → `0.05`
- 7.5% → `0.075`
- 10% → `0.10`

### Date Format
- Use SQL DATE format: `'YYYY-MM-DD'`
- Current rates: `expires_date = NULL`
- Expired rates: `expires_date = '<date>'`

### User Matching
- The query matches on `users.email`
- Make sure emails match **exactly** between Paycom and CRM
- Only sales roles: `u.role IN ('sales', 'inside_sales')`

---

## ✅ Verification

After populating, run this to verify:

```sql
-- See all current active rates
SELECT * FROM v_current_commission_rates ORDER BY user_name;
```

Expected output:
```
user_name       | commission_rate | effective_date | expires_date
----------------|-----------------|----------------|-------------
Jane Smith      | 0.06000        | 2024-07-01     | NULL
John Doe        | 0.05000        | 2024-01-01     | NULL
```

---

## 🤖 How It Works After Setup

**Automatic commission creation:**

1. Estimate status changes to `'won'` ✅
2. Trigger looks up `leads.crm_rep`
3. Trigger sums `estimate_line_items.total_price_cents`
4. Trigger fetches current rate for that rep
5. Trigger calculates: `commission = contract_value * rate`
6. Trigger inserts into `commissions` table (status = 'approved')

**No manual steps!** Commissions are created automatically for every won deal.

---

## 📞 Questions?

If you need help with:
- Exporting from Paycom
- SQL query generation
- Bulk insert scripts
- Ongoing sync strategy

Let me know and I can provide more specific guidance!

---

**Created**: 2024-01-16  
**Part of**: Commissions Page Feature  
**See also**: `docs/commissions_page_handoff.md`
