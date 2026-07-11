using plugin.langgraph.persistence as langgraph from '@mi8y/cds-langgraph-persistence';

service InfoService {
  entity Books {
    key ID     : Integer;
        title  : String;
        author : String;
  }

  entity Checkpoints as projection on langgraph.Checkpoints;
}
