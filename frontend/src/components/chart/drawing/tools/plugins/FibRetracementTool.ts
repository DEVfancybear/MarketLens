/** Preferred two-anchor Fibonacci retracement adapter. */
import { registerTool } from "../ToolRegistry";
import { createFibRetracementPlugin } from "./fibRetracementFamily";

registerTool(createFibRetracementPlugin("fibRetracement"));
