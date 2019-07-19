import URI from 'vscode-uri/lib/umd';
import * as vscode from 'vscode';
import { ExtensionDocumentDataManager } from '../../common';
import { FoldingContext, FoldingRange } from '../../common/model.api';
import * as Converter from '../../common/converter';

export class FoldingProviderAdapter {

  constructor(
    private documents: ExtensionDocumentDataManager,
    private provider: vscode.FoldingRangeProvider,
  ) { }

  async provideFoldingRanges(resource: URI, context: FoldingContext, token: vscode.CancellationToken): Promise<FoldingRange[] | undefined> {
    const documentData = this.documents.getDocumentData(resource);
    if (!documentData) {
      return Promise.reject(new Error(`There is no document for ${resource}`));
    }
    const doc = documentData.document;
    const ranges = this.provider.provideFoldingRanges(doc, context, token);
    if (!Array.isArray(ranges)) {
      return undefined;
    }
    return ranges.map(Converter.fromFoldingRange);
  }
}
