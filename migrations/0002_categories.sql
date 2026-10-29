-- Starting categories. Fixed ids so the spreadsheet import can reference them.

INSERT INTO categories (id, kind, name_en, name_hi, icon, sort, show_on_entry, tracks_workers) VALUES
  (1,  'expense', 'Labor',           'मज़दूरी',          '👷', 10, 1, 1),
  (2,  'expense', 'Transport',       'गाड़ी / भाड़ा',     '🚚', 20, 1, 0),
  (3,  'expense', 'Supplies',        'सामान / दवाई',     '🧴', 30, 1, 0),
  (4,  'expense', 'Cow Feed',        'पशु चारा',         '🐄', 40, 1, 0),
  (5,  'expense', 'Caretaker Pay',   'तनख्वाह',          '💵', 50, 1, 0),
  (6,  'expense', 'Gas & Utilities', 'गैस / बिजली',      '🔥', 60, 1, 0),
  (7,  'expense', 'Other Expenses',  'अन्य खर्चा',        '📝', 90, 1, 0),
  (8,  'expense', 'Feed & Supplies', 'चारा / सामान',     '🌾', 45, 0, 0),
  (9,  'expense', 'CA / Accounts',   'CA / हिसाब',       '📒', 95, 0, 0),

  (20, 'income',  'Apple',           'सेब',              '🍎', 10, 1, 0),
  (21, 'income',  'Pear',            'नाशपाती',          '🍐', 20, 1, 0),
  (22, 'income',  'Plum',            'आलूबुखारा',        '🍑', 30, 1, 0),
  (23, 'income',  'Garlic',          'लहसुन',            '🧄', 40, 1, 0),
  (24, 'income',  'Gobi',            'गोभी',             '🥦', 50, 1, 0),
  (25, 'income',  'Rajma',           'राजमा',            '🫘', 60, 1, 0),
  (26, 'income',  'Cow Milk',        'दूध',              '🥛', 70, 1, 0),
  (27, 'income',  'Rent',            'किराया',           '🏠', 80, 1, 0),
  (28, 'income',  'Other Income',    'अन्य कमाई',         '💰', 90, 1, 0),

  (40, 'capital', 'Owner''s Capital', 'मालिक से पैसा',   '🏦', 10, 0, 0);
