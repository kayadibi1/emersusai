-- Expand the exercises.category CHECK to include swimming, climbing, hybrid.
-- Seed a minimal set of swim + climb exercises.

ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS exercises_category_check;

ALTER TABLE public.exercises
  ADD CONSTRAINT exercises_category_check
  CHECK (category IN ('resistance', 'cardio', 'bodyweight', 'swimming', 'climbing', 'hybrid'));

INSERT INTO public.exercises (slug, name, aliases, muscle_groups, equipment, category, movement_type) VALUES
  ('swimming_freestyle',    'Freestyle Swim',    '{"Freestyle","Front Crawl","Free"}', '{}', 'pool',  'swimming', null),
  ('swimming_backstroke',   'Backstroke',        '{"Back"}',                           '{}', 'pool',  'swimming', null),
  ('swimming_breaststroke', 'Breaststroke',      '{"Breast"}',                         '{}', 'pool',  'swimming', null),
  ('swimming_butterfly',    'Butterfly',         '{"Fly","Butterfly Swim"}',           '{}', 'pool',  'swimming', null),
  ('swimming_im',           'Individual Medley', '{"IM","Medley"}',                    '{}', 'pool',  'swimming', null),
  ('swimming_open_water',   'Open Water Swim',   '{"OWS"}',                            '{}', 'open',  'swimming', null),
  ('bouldering',            'Bouldering',        '{"Boulder"}',                        '{}', 'wall',  'climbing', null),
  ('sport_climbing',        'Sport Climbing',    '{"Lead","Sport Climb"}',             '{}', 'wall',  'climbing', null),
  ('top_rope_climbing',     'Top-rope Climbing', '{"Top Rope","TR"}',                  '{}', 'wall',  'climbing', null),
  ('trad_climbing',         'Trad Climbing',     '{"Trad"}',                           '{}', 'wall',  'climbing', null)
ON CONFLICT (slug) DO NOTHING;
