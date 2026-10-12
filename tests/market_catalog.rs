//! Nonempty migrations and actual financial edge cases, not product counters.
use ed25519_dalek::SigningKey;
use flypow::target_authority::{market::{money, ListQuery}, Authority, AuthorityConfig};
use flypow_target_protocol as p;
use rusqlite::Connection;
use serde_json::json;
use std::path::PathBuf;

pub fn config() -> AuthorityConfig {
    let keys=(1..=4).map(|i|p::hex(SigningKey::from_bytes(&[i;32]).verifying_key().as_bytes())).collect::<Vec<_>>();
    AuthorityConfig {schema:"flypow-target-authority-config-v2".into(),network_id:"isolated-market-catalog".into(),campaign_id:"fixture".into(),goal_paths:vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web/data/target-mining-v2/product-group-1-20261011/goal.json")],verifier_keys:keys[..3].to_vec(),admin_keys:vec![keys[3].clone()],allowed_origins:vec!["https://flybrain.work".into()],tau_seconds:300,search_seconds:120,reveal_seconds:60,verification_seconds:1200,max_queue:8,per_identity_claims:2,max_private_bytes:512*1024*1024,family_paths:vec![]}
}

#[test]
fn nonempty_legacy_state_survives_repeatable_catalog_migration() {
    let dir=tempfile::tempdir().unwrap();
    let a=Authority::open(dir.path().into(),config()).unwrap();
    let old_round=a.current().unwrap();
    let database=Connection::open(dir.path().join("target-v2.sqlite")).unwrap();
    let before:u64=database.query_row("SELECT COUNT(*) FROM target_rounds",[],|r|r.get(0)).unwrap();
    database.execute("INSERT INTO service_requests VALUES('private-old-request','private-key','hash','access','{\"contact\":\"private@example.invalid\"}','scoping',1,1)",[]).unwrap();
    a.market_initialize().unwrap();
    assert_eq!(before,database.query_row("SELECT COUNT(*) FROM target_rounds",[],|r|r.get::<_,u64>(0)).unwrap());
    assert_eq!(a.current().unwrap(),old_round);
    let projects=a.market_public("projects",&ListQuery::default()).unwrap();
    assert_eq!(projects["projects"].as_array().unwrap().len(),10);
    assert!(projects["projects"].as_array().unwrap().iter().all(|p|p["projectStatus"]=="proposed"&&p["achievedMetrics"].is_null()&&p["currentActivity"]["freshExecutions"]==0));
    let models=a.market_public("models",&ListQuery::default()).unwrap();
    assert_eq!(models["models"],json!([]));
    assert_eq!(models["upcoming"].as_array().unwrap().len(),5);
    let prices=a.market_public("prices",&ListQuery::default()).unwrap();
    assert_eq!(prices["prices"].as_array().unwrap().len(),8);
    assert!(prices["prices"].as_array().unwrap().iter().all(|p|p["state"]=="draft"));
    assert!(!projects.to_string().contains("private@example"));
    assert_eq!(database.query_row("SELECT COUNT(*) FROM service_requests",[],|r|r.get::<_,u64>(0)).unwrap(),1);
    drop(a);
    let a=Authority::open(dir.path().into(),config()).unwrap();
    assert_eq!(a.market_public("projects",&ListQuery::default()).unwrap()["projects"].as_array().unwrap().len(),10);
}

#[test]
fn canonical_money_cumulative_dust_and_supply_independent_turnover() {
    for bad in ["","-1","1.0","01","1e8","+1"," 1","340282366920938463463374607431768211456"] {assert!(money::atoms(bad).is_err());}
    assert_eq!(money::atoms("1").unwrap(),1);
    let (pools,reserve)=money::pools(100_000*100_000_000,[6000,2500,500,1000]).unwrap();
    assert_eq!(pools,[60_000*100_000_000,25_000*100_000_000,5_000*100_000_000,10_000*100_000_000]);
    assert_eq!(reserve,0);
    let a=money::proportional(pools[0],200,10_000).unwrap();
    assert_eq!(a,1200*100_000_000);
    assert_eq!(money::sub(a,300*100_000_000).unwrap(),900*100_000_000);
    let mut cumulative=[0;4];let mut sum=[0;4];let mut reserve=0;
    for total in 1..=100_003 {
        let (next,rest)=money::pools(total,[6000,2500,500,1000]).unwrap();
        for i in 0..4 {sum[i]+=next[i]-cumulative[i];}cumulative=next;reserve=rest;
    }
    let once=money::pools(100_003,[6000,2500,500,1000]).unwrap();
    assert_eq!((sum,reserve),once);
    assert_eq!(sum.iter().sum::<u128>()+reserve,100_003);
    assert!(money::pools(31_183_324_300_000_000*1000,[6000,2500,500,1000]).is_ok());
    assert_eq!(money::proportional(u128::MAX,1,1).unwrap(),u128::MAX);
    assert!(money::add(u128::MAX,1).is_err());
}
