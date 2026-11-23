import { expect, it } from 'vitest';
import { booleanObjects, deserializeProject, serializeProject } from 'libopenlaser/project';
import { compileJob } from 'libopenlaser/cam';
import { compileInput, layer, project, rectPath, vectorObject } from './fixtures';

it.each(['line', 'fill'] as const)(
  'Boolean holes survive .olaser round trips and %s G-code compilation',
  async (mode) => {
    const source = project(
      [
        layer({
          id: 'l',
          mode,
          line: { kerfOffset: 0.1 },
          fill: { interval: 0.5, angle: 0, bidirectional: true, crossHatch: false, overscan: 0 },
        }),
      ],
      [
        vectorObject('base', 'l', [rectPath(10, 10, 20, 20)]),
        vectorObject('hole', 'l', [rectPath(15, 15, 10, 10)]),
      ],
    );
    const result = booleanObjects(source, ['base', 'hole'], 'subtract', 'result').project;
    const restored = await deserializeProject(await serializeProject(result));
    expect(restored.objects[0]).toMatchObject({
      id: 'result',
      layerId: 'l',
      paths: expect.arrayContaining([expect.objectContaining({ closed: true })]),
    });
    const plan = compileJob(compileInput(restored));
    expect(plan.warnings.filter((w) => w.blocking)).toEqual([]);
    expect(plan.toolpaths).toHaveLength(1);
    expect(plan.gcode.join('\n')).toMatch(/G1/);
    expect(plan.gcode.join('\n')).not.toMatch(/NaN|Infinity/);
    expect(plan.toolpaths[0].runs.length).toBeGreaterThan(1);
  },
);
