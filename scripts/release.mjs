#!/usr/bin/env node
// Release automation. Dependency-free.
//   node scripts/release.mjs prepare         On develop: derive the next version from the Conventional Commit
//                                            subjects since the newest v* tag, write it to .claude-plugin/plugin.json
//                                            and write its CHANGELOG section. Every untagged section is rebuilt on
//                                            each run, so a release pull request that grows stays in step.
//   node scripts/release.mjs notes <version> Print that version's CHANGELOG section (the release notes).
// Bumps: before 1.0 a breaking change (`type!:` or a `BREAKING CHANGE:` footer) raises the minor, anything else the
// patch; from 1.0 on breaking raises the major, `feat` the minor, anything else the patch.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const MANIFEST = '.claude-plugin/plugin.json'
const CHANGELOG = 'CHANGELOG.md'
const REPO = 'https://github.com/agentic-workbench/agent-quick-menu'
const TYPE = /^(\w+)(\([^)]*\))?(!)?:\s*/

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

// The CHANGELOG as preamble, `## [version]` sections and the trailing `[version]: url` links.
function parseChangelog(text) {
  const links = text.split('\n').filter((l) => /^\[[^\]]+\]: \S+$/.test(l))
  const body = text.split('\n').filter((l) => !/^\[[^\]]+\]: \S+$/.test(l)).join('\n')
  const [preamble, ...rest] = body.split(/^(?=## \[)/m)
  const sections = rest.map((s) => ({ version: s.match(/^## \[([^\]]+)\]/)[1], text: s.trimEnd() }))
  return { preamble: preamble.trimEnd(), sections, links }
}

function writeChangelog({ preamble, sections, links }) {
  writeFileSync(CHANGELOG, [preamble, ...sections.map((s) => s.text), links.join('\n')].join('\n\n') + '\n')
}

function nextVersion(last, commits) {
  const [major, minor, patch] = last.split('.').map(Number)
  const breaking = commits.some((c) => TYPE.exec(c.subject)?.[3] || /^BREAKING[ -]CHANGE:/m.test(c.body))
  const feat = commits.some((c) => TYPE.exec(c.subject)?.[1] === 'feat')
  if (major === 0) return breaking ? `0.${minor + 1}.0` : `0.${minor}.${patch + 1}`
  return breaking ? `${major + 1}.0.0` : feat ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
}

function section(version, commits) {
  const groups = { Added: [], Changed: [], Fixed: [] }
  for (const { subject } of commits) {
    const type = TYPE.exec(subject)?.[1]
    const line = subject.replace(TYPE, '')
    groups[type === 'feat' ? 'Added' : type === 'fix' ? 'Fixed' : 'Changed'].push(`- ${line[0].toUpperCase()}${line.slice(1)}`)
  }
  const parts = [`## [${version}] - ${new Date().toISOString().slice(0, 10)}`]
  for (const [name, lines] of Object.entries(groups)) if (lines.length) parts.push(`### ${name}`, lines.join('\n'))
  return parts.join('\n\n')
}

function prepare() {
  const tags = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean)
  const last = tags[0]
  const commits = git('log', '--reverse', '--format=%s%x1f%b%x1e', `${last}..HEAD`)
    .split('\x1e')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [subject, body = ''] = c.split('\x1f')
      return { subject: subject.trim(), body }
    })
    .filter((c) => !/^chore\(release\)/.test(c.subject))
  if (!commits.length) return console.log(`nothing to release since ${last}`)

  const version = nextVersion(last.slice(1), commits)
  const tagged = new Set(tags.map((t) => t.slice(1)))
  const log = parseChangelog(readFileSync(CHANGELOG, 'utf8'))
  log.sections = [{ version, text: section(version, commits) }, ...log.sections.filter((s) => tagged.has(s.version))]
  log.links = [`[${version}]: ${REPO}/compare/${last}...v${version}`, ...log.links.filter((l) => tagged.has(l.slice(1, l.indexOf(']'))))]
  writeChangelog(log)

  const manifest = readFileSync(MANIFEST, 'utf8')
  writeFileSync(MANIFEST, manifest.replace(/("version":\s*")[^"]+"/, `$1${version}"`))
  console.log(version)
}

function notes(version) {
  const found = parseChangelog(readFileSync(CHANGELOG, 'utf8')).sections.find((s) => s.version === version)
  if (!found) throw new Error(`no CHANGELOG section for ${version}`)
  console.log(found.text.split('\n').slice(1).join('\n').trim())
}

const [mode, arg] = process.argv.slice(2)
if (mode === 'prepare') prepare()
else if (mode === 'notes' && arg) notes(arg)
else {
  console.error('usage: release.mjs prepare | notes <version>')
  process.exit(2)
}
