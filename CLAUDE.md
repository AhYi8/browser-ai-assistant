# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 代码审查约定

- 每次代码审查都需要审查**所有未提交（git commit）的代码，包括未跟踪的代码（untracked）**，不仅仅是 staged 和 unstaged 的变更。
- **审查时禁止启动 subagent**，必须直接在主会话中读取文件并分析。
- **审查时禁止执行 git stash**，审查应基于当前工作目录的变更。