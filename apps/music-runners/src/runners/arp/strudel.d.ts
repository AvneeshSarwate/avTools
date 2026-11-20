// The slice of @strudel/mini (and the @strudel/core Pattern it returns) that
// the arp uses. The package ships no types.
declare module "@strudel/mini" {
  interface StrudelFraction {
    valueOf(): number;
  }
  interface StrudelHap {
    whole: { begin: StrudelFraction; end: StrudelFraction } | undefined;
    value: unknown;
    /** Source positions of the atoms that made this event (mini() adds them; offsets in the quoted code). */
    context?: { locations?: Array<{ start: number; end: number }> };
    hasOnset(): boolean;
  }
  interface StrudelPattern {
    queryArc(begin: number, end: number): StrudelHap[];
  }
  /** Mini-notation text (without quotes) to a pattern; throws on a parse error. */
  export function mini(text: string): StrudelPattern;
  /** The atoms of quoted mini-notation code (`"0 1 2"` with the quotes); throws on a parse error. */
  export function getLeaves(code: string): Array<{ source_: string }>;
}
