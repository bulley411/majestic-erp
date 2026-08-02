-- Ledger integrity guards.
-- These run in the database, so no application bug can write an
-- unbalanced or negative entry, and posted entries cannot be altered.

-- 1. A line is either a debit or a credit, never both, never negative.
ALTER TABLE "JournalLine"
  DROP CONSTRAINT IF EXISTS journalline_sign_check;
ALTER TABLE "JournalLine"
  ADD CONSTRAINT journalline_sign_check
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0));

-- 2. Every posted entry must balance. Deferred so lines can be inserted
--    one at a time inside a transaction.
CREATE OR REPLACE FUNCTION assert_entry_balances() RETURNS trigger AS $$
DECLARE
  d NUMERIC(19,4);
  c NUMERIC(19,4);
  st TEXT;
BEGIN
  SELECT status INTO st FROM "JournalEntry" WHERE id = NEW."entryId";
  IF st IS DISTINCT FROM 'POSTED' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c
    FROM "JournalLine" WHERE "entryId" = NEW."entryId";
  IF d <> c THEN
    RAISE EXCEPTION 'Journal entry % does not balance: debits %, credits %',
      NEW."entryId", d, c;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journalline_balance_check ON "JournalLine";
CREATE CONSTRAINT TRIGGER journalline_balance_check
  AFTER INSERT OR UPDATE ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_entry_balances();

-- 3. Posted entries are immutable. Correct by reversing, never by editing.
CREATE OR REPLACE FUNCTION forbid_posted_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status <> 'REVERSED' THEN
    RAISE EXCEPTION 'Journal entry % is posted and cannot be modified. Post a reversing entry instead.', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journalentry_immutable ON "JournalEntry";
CREATE TRIGGER journalentry_immutable
  BEFORE UPDATE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION forbid_posted_mutation();

-- 4. Lines of a posted entry cannot be deleted or changed.
CREATE OR REPLACE FUNCTION forbid_posted_line_mutation() RETURNS trigger AS $$
DECLARE st TEXT;
BEGIN
  SELECT status INTO st FROM "JournalEntry"
    WHERE id = COALESCE(OLD."entryId", NEW."entryId");
  IF st = 'POSTED' THEN
    RAISE EXCEPTION 'Cannot modify lines of a posted journal entry.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journalline_immutable ON "JournalLine";
CREATE TRIGGER journalline_immutable
  BEFORE UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION forbid_posted_line_mutation();

-- 5. No posting into a closed fiscal period.
CREATE OR REPLACE FUNCTION forbid_closed_period() RETURNS trigger AS $$
DECLARE closed BOOLEAN;
BEGIN
  SELECT "isClosed" INTO closed FROM "FiscalPeriod" WHERE id = NEW."periodId";
  IF closed AND NEW.status = 'POSTED' THEN
    RAISE EXCEPTION 'Fiscal period is closed. Reopen it before posting.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journalentry_period_open ON "JournalEntry";
CREATE TRIGGER journalentry_period_open
  BEFORE INSERT OR UPDATE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION forbid_closed_period();
