-- SQL CHECK permits NULL results; explicitly require amounts for feed rows too.
ALTER TABLE day_events ADD CONSTRAINT feed_amount_required CHECK(type <> 'feed' OR amount_oz IS NOT NULL);
