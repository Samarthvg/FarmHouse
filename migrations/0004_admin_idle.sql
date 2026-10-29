-- Admin sessions now end after 30 minutes without use. Sign out the long-lived admin sessions made
-- before that rule, so none of them outlives it.
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'admin');
