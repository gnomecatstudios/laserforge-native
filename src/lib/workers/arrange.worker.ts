import { arrangeObjects } from '../../app/lib/arrange';
self.onmessage = (event) => {
  try {
    const { project, ids, settings, scope } = event.data;
    const result = arrangeObjects(project, ids, settings, scope, (progress) =>
      self.postMessage({ progress }),
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Arrangement failed.' });
  }
};
