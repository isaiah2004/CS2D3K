/** Working directory for the next terminal that gets created (set by "Open terminal here"). */
export const nextTerminalCwd = {
  value: null as string | null,
  set(v: string | null): void {
    this.value = v
  },
  /** returns and clears the pending cwd */
  take(): string | null {
    const v = this.value
    this.value = null
    return v
  }
}
