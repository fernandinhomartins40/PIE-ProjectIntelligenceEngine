export declare const fullPieTests: string[];
export declare function selectPieTests(
  changedPaths: string[],
  eventName?: string,
): {
  mode: "focused" | "full";
  tests: string[];
  reason: string;
};
