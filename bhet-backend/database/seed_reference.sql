-- Reference data (safe to run repeatedly)
INSERT IGNORE INTO interests (name) VALUES
 ('Hiking'),('Music'),('Food'),('Books'),('Films'),('Sport'),('Coffee'),('Cycling'),
 ('Art'),('Yoga'),('Cooking'),('Travel'),('Photography'),('Gaming');

INSERT IGNORE INTO venues (name, area, category) VALUES
 ('Thamel Cafe','Kathmandu Valley','cafe'),
 ('Patan Dhoka Cafe','Kathmandu Valley','cafe'),
 ('Jawalakhel Park','Kathmandu Valley','park'),
 ('Garden of Dreams','Kathmandu Valley','park'),
 ('Bhaktapur Durbar Square Cafe','Kathmandu Valley','cafe');
