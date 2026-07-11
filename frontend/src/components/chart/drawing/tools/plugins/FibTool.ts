/** Legacy `fib` adapter. Geometry is shared with Fib Retracement. */
import { registerTool } from "../ToolRegistry";
import { createFibRetracementPlugin } from "./fibRetracementFamily";

registerTool(createFibRetracementPlugin("fib"));
