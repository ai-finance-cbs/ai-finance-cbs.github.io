#!/usr/bin/env ruby
# Read the archived course text. Write a local SQL seed that Git and Jekyll exclude.
require 'yaml'
require 'cgi'
require 'fileutils'
root = File.expand_path('..', __dir__)
milestones = File.join(root, '__archive__/20260929/removed-from-repo/milestones.yml')
requested = File.join(root, '__archive__/20260930/before-merge/syllabus.html')
fallback = File.join(root, '__archive__/20260928/before-merge/syllabus.html')
source = File.exist?(requested) ? requested : fallback
rows = YAML.safe_load(File.read(milestones, encoding: 'UTF-8'))
html = File.read(source, encoding: 'UTF-8')
block = html[/<section class="project-block" id="final-prototype".*?<\/section>/m]
raise 'Final Prototype section not found' unless block
plain = ->(s) { CGI.unescapeHTML(s.gsub(/<[^>]+>/, '').strip) }
paragraphs = block.scan(/<p>(.*?)<\/p>/m).flatten.map(&plain)
outline = block.scan(/<li>(.*?)<\/li>/m).flatten.map(&plain)
pairs = block.scan(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/m).to_h { |a, b| [plain.call(a), plain.call(b)] }
assignments = rows.map { |r| [r['number'], r['title'], "Before Week #{r['number']}", 10, r['description'], r['deliverable'], r['grading']] }
assignments << [6, 'Show it working', 'Before Week 6', 25, (paragraphs + outline).join("\n\n"), pairs.fetch('Deliverable'), pairs.fetch('Graded on')]
quote = ->(v) { v.is_a?(Integer) ? v.to_s : "'#{v.gsub("'", "''")}'" }
sql = "-- PRIVATE LOCAL SEED. Do not commit or copy into public assets.\n-- Milestones: #{milestones}\n-- Final Prototype source: #{source}\n-- Run after 003_class_tools.sql. Existing edits are preserved.\nbegin;\n"
sql += "insert into public.assignments(id,title,due,points,description,deliverable,grading,auditor_visible) values\n"
sql += assignments.map { |row| '(' + row.map(&quote).join(',') + ',false)' }.join(",\n")
sql += "\non conflict (id) do nothing;\ncommit;\n"
folder = File.join(root, 'supabase/private')
FileUtils.mkdir_p(folder)
out = File.join(folder, 'seed.sql')
raise 'Seed already exists; archive it before regenerating.' if File.exist?(out)
File.write(out, sql)
puts "Created #{out} (#{assignments.length} assignments)."
puts "Final Prototype source: #{source}"
