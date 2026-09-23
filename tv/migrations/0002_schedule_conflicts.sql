DROP INDEX IF EXISTS display_schedule_precedence;
CREATE TRIGGER IF NOT EXISTS display_schedule_insert
BEFORE INSERT ON display_items WHEN NEW.kind='schedule' AND NEW.status='published'
BEGIN
 SELECT RAISE(ABORT, 'display_schedule_conflict') WHERE EXISTS (
  SELECT 1 FROM display_items old WHERE old.kind='schedule' AND old.status='published'
   AND old.id<>NEW.id AND old.starts_at<NEW.ends_at AND NEW.starts_at<old.ends_at
   AND json_extract(old.data_json,'$.appliesFrom')<=json_extract(NEW.data_json,'$.appliesTo')
   AND json_extract(NEW.data_json,'$.appliesFrom')<=json_extract(old.data_json,'$.appliesTo')
   AND (json_extract(old.data_json,'$.portion')='all' OR json_extract(NEW.data_json,'$.portion')='all' OR json_extract(old.data_json,'$.portion')=json_extract(NEW.data_json,'$.portion'))
   AND (json_extract(NEW.data_json,'$.overlapAcknowledged')<>1 OR json_extract(old.data_json,'$.precedence')=json_extract(NEW.data_json,'$.precedence'))
 );
END;
CREATE TRIGGER IF NOT EXISTS display_schedule_update
BEFORE UPDATE ON display_items WHEN NEW.kind='schedule' AND NEW.status='published'
BEGIN
 SELECT RAISE(ABORT, 'display_schedule_conflict') WHERE EXISTS (
  SELECT 1 FROM display_items old WHERE old.kind='schedule' AND old.status='published'
   AND old.id<>NEW.id AND old.starts_at<NEW.ends_at AND NEW.starts_at<old.ends_at
   AND json_extract(old.data_json,'$.appliesFrom')<=json_extract(NEW.data_json,'$.appliesTo')
   AND json_extract(NEW.data_json,'$.appliesFrom')<=json_extract(old.data_json,'$.appliesTo')
   AND (json_extract(old.data_json,'$.portion')='all' OR json_extract(NEW.data_json,'$.portion')='all' OR json_extract(old.data_json,'$.portion')=json_extract(NEW.data_json,'$.portion'))
   AND (json_extract(NEW.data_json,'$.overlapAcknowledged')<>1 OR json_extract(old.data_json,'$.precedence')=json_extract(NEW.data_json,'$.precedence'))
 );
END;
